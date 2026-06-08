const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const fetch = require('node-fetch');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function testVertexAI() {
  try {
    const cred = admin.app().options.credential;
    const tokenObj = await cred.getAccessToken();
    const token = tokenObj.accessToken;
    console.log('Got Access Token successfully!');

    // Let's call the Vertex AI Gemini API endpoint
    const projectId = serviceAccount.project_id;
    const location = 'us-central1';
    const model = 'gemini-1.5-flash-preview-0514'; // or 'gemini-2.5-flash'
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
    console.error('Error during token/Vertex test:', err);
  }
  process.exit(0);
}

testVertexAI();
