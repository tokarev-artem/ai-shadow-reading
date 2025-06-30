const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const polly = new PollyClient();

// Helper to get speech marks
async function getSpeechMarks(params) {
  // Include both word and ssml marks to capture pauses
  const speechMarksParams = { ...params, OutputFormat: 'json', SpeechMarkTypes: ['word', 'ssml'] };
  const command = new SynthesizeSpeechCommand(speechMarksParams);
  const response = await polly.send(command);
  if (!response.AudioStream) throw new Error('No speech marks stream');
  let jsonStr = '';
  for await (const chunk of response.AudioStream) {
    jsonStr += chunk.toString();
  }
  // Polly returns one JSON object per line
  const speechMarks = jsonStr.trim().split('\n').map(line => JSON.parse(line));
  console.log('Generated Speech Marks:', speechMarks); // Debug logging
  return speechMarks;
}

exports.handler = async (event) => {
  try {
    const { text, voiceId } = JSON.parse(event.body || '{}');
    
    if (!text || !voiceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Text and voiceId are required' })
      };
    }

    // Check if text contains valid SSML
    const isSSML = text.includes('<speak>') && text.includes('</speak>');
    if (isSSML) {
      // Basic SSML validation
      if (!/<speak>[\s\S]*<\/speak>/.test(text)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid SSML format' })
        };
      }
      console.log('Received SSML:', text);
    }

    const ssmlText = isSSML ? text : `<speak><prosody rate="medium">${text}</prosody></speak>`;

    const params = {
      OutputFormat: 'mp3',
      Text: ssmlText,
      TextType: 'ssml',
      VoiceId: voiceId,
      Engine: 'neural'
    };

    // Get audio (mp3)
    const audioCommand = new SynthesizeSpeechCommand(params);
    const audioResponse = await polly.send(audioCommand);
    if (!audioResponse.AudioStream) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'No audio stream received from Polly' })
      };
    }
    const audioChunks = [];
    for await (const chunk of audioResponse.AudioStream) {
      audioChunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(audioChunks);

    // Get speech marks
    let speechMarks = [];
    try {
      speechMarks = await getSpeechMarks(params);
      if (!speechMarks.length) {
        throw new Error('No speech marks generated');
      }
    } catch (e) {
      console.error('Polly SpeechMarks error:', e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to generate speech marks' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: audioBuffer.toString('base64'),
        speechMarks
      }),
      isBase64Encoded: false
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process text' })
    };
  }
};