const { JWT } = require('google-auth-library');
const serviceAccount = require('./serviceAccountKey.json');
const fetch = require('node-fetch');

async function testJWT() {
  try {
    const client = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const credentials = await client.authorize();
    const token = credentials.access_token;
    console.log('Got GCP OAuth Access Token successfully!');

    const projectId = serviceAccount.project_id;
    const location = 'us-central1';
    const model = 'gemini-1.5-flash-001'; // use standard stable name
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    console.log(`Querying Vertex AI: ${url}`);
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
    console.error('Error during JWT/Vertex test:', err);
  }
  process.exit(0);
}

testJWT();
