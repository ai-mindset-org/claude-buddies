exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { image } = JSON.parse(event.body);
  if (!image) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: `Extract the Claude Code /buddy companion card data from this screenshot. Return ONLY a valid JSON object with these fields:
{
  "name": "buddy name",
  "species": "SPECIES IN CAPS",
  "rarity": "COMMON or UNCOMMON or RARE or EPIC or LEGENDARY",
  "description": "the description text from the card",
  "ascii": "ASCII art as multi-line string",
  "stats": { "debugging": 0, "patience": 0, "chaos": 0, "wisdom": 0, "snark": 0 },
  "lastSaid": { "action": "*action text*", "words": "speech text" }
}
Return ONLY the JSON, no markdown, no explanation.` }
          ]
        }]
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
