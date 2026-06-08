const { JWT } = require('google-auth-library');
const serviceAccount = require('./serviceAccountKey.json');
const fetch = require('node-fetch');

async function testGenerativeLanguage() {
  try {
    const client = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language'],
    });

    const credentials = await client.authorize();
    const token = credentials.access_token;
    console.log('Got GCP OAuth Access Token successfully!');

    // Let's call the Generative Language API with OAuth token
    // Endpoint format: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

    console.log(`Querying Generative Language API: ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Respond with the word "Success" if you read this.' }]
          }
        ]
      })
    });

    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error during test:', err);
  }
  process.exit(0);
}

testGenerativeLanguage();
