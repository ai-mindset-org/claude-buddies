exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: '{"error":"Invalid JSON"}' }; }

  const { image, owner, action } = body;
  if (!image) return { statusCode: 400, headers, body: '{"error":"No image"}' };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: '{"error":"API key not configured"}' };

  // Step 1: Parse image with Vision API
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: 'Extract Claude Code /buddy card data. Return ONLY valid JSON:\n{"name":"...","species":"CAPS","rarity":"COMMON|UNCOMMON|RARE|EPIC|LEGENDARY","description":"...","ascii":"multiline ascii art","stats":{"debugging":0,"patience":0,"chaos":0,"wisdom":0,"snark":0},"lastSaid":{"action":"*...*","words":"..."}}\nNo markdown wrapping.' }
          ]
        }]
      })
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { statusCode: 422, headers, body: JSON.stringify({ error: 'Could not extract data', raw: content.slice(0, 200) }) };

    const buddy = JSON.parse(jsonMatch[0]);
    if (!buddy.name) return { statusCode: 422, headers, body: JSON.stringify({ error: 'No name found', buddy }) };

    // If action=submit, commit to GitHub
    if (action === 'submit') {
      const ghToken = process.env.GITHUB_TOKEN;
      if (!ghToken) return { statusCode: 200, headers, body: JSON.stringify({ ...buddy, committed: false, reason: 'No GitHub token' }) };

      const repo = 'ai-mindset-org/claude-buddies';
      const ghHeaders = { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' };

      // Get current file
      const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, { headers: ghHeaders });
      const fileData = await fileRes.json();
      const currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');

      // Check duplicate
      if (currentContent.includes(`name: "${buddy.name}"`)) {
        return { statusCode: 200, headers, body: JSON.stringify({ ...buddy, committed: false, reason: 'duplicate' }) };
      }

      // Build entry
      const rarityColors = {
        COMMON: ['--text-dim', 'linear-gradient(90deg, rgba(230,237,243,0.2), rgba(230,237,243,0.1))'],
        UNCOMMON: ['--accent-teal', 'linear-gradient(90deg, var(--accent-teal), var(--accent-green))'],
        RARE: ['--accent-purple', 'linear-gradient(90deg, var(--accent-purple), var(--accent-blue))'],
        EPIC: ['--accent-amber', 'linear-gradient(90deg, var(--accent-amber), var(--accent-red))'],
        LEGENDARY: ['--accent-pink', 'linear-gradient(90deg, var(--accent-pink), var(--accent-purple))']
      };
      const [color, gradient] = rarityColors[buddy.rarity] || rarityColors.COMMON;
      const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
      const ascii = esc(buddy.ascii || '?');
      const desc = esc(buddy.description || '');
      const sAction = esc(buddy.lastSaid?.action || '');
      const sWords = esc(buddy.lastSaid?.words || '...');
      const ownerName = owner || 'anonymous';

      const entry = `  {
    name: "${esc(buddy.name)}",
    species: "${esc(buddy.species)}",
    rarity: "${buddy.rarity || 'COMMON'}",
    color: "${color}",
    gradient: "${gradient}",
    owner: "${esc(ownerName)}",
    env: "",
    ascii: "${ascii}",
    description: "${desc}",
    stats: { debugging: ${buddy.stats?.debugging||0}, patience: ${buddy.stats?.patience||0}, chaos: ${buddy.stats?.chaos||0}, wisdom: ${buddy.stats?.wisdom||0}, snark: ${buddy.stats?.snark||0} },
    tags: [],
    lastSaid: { action: "${sAction}", words: "${sWords}" }
  }`;

      // Insert before ];\n\nconst COMPANIONS
      let newContent = currentContent.replace(
        /(\n\];\n\nconst COMPANIONS)/,
        `,\n${entry}\n];\n\nconst COMPANIONS`
      );

      // Update count
      const countMatch = newContent.match(/<strong id="buddy-count">(\d+)<\/strong>/);
      if (countMatch) {
        const n = parseInt(countMatch[1]) + 1;
        newContent = newContent.replace(/<strong id="buddy-count">\d+<\/strong>/, `<strong id="buddy-count">${n}</strong>`);
        newContent = newContent.replace(/id="tab-buddy-count">\d+</, `id="tab-buddy-count">${n}<`);
      }

      // Commit
      const commitRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `add ${buddy.name} (${buddy.species}) from ${ownerName}`,
          content: Buffer.from(newContent).toString('base64'),
          sha: fileData.sha
        })
      });

      const commitData = await commitRes.json();
      return { statusCode: 200, headers, body: JSON.stringify({ ...buddy, committed: true, commit: commitData.commit?.sha?.slice(0,7) }) };
    }

    // Just return parsed data (preview mode)
    return { statusCode: 200, headers, body: JSON.stringify(buddy) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
