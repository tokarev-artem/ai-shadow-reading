const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const polly = new PollyClient();

// Helper to get speech marks
async function getSpeechMarks(params) {
  const speechMarksParams = { ...params, OutputFormat: 'json', SpeechMarkTypes: ['word'] };
  const command = new SynthesizeSpeechCommand(speechMarksParams);
  const response = await polly.send(command);
  if (!response.AudioStream) throw new Error('No speech marks stream');
  let jsonStr = '';
  for await (const chunk of response.AudioStream) {
    jsonStr += chunk.toString();
  }
  // Polly returns one JSON object per line
  return jsonStr.trim().split('\n').map(line => JSON.parse(line));
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

    // Check if text already contains SSML tags
    const isSSML = text.includes('<speak>') && text.includes('</speak>');
    const ssmlText = isSSML ? text : `<speak><prosody rate="medium">${text}</prosody></speak>`;

    const params = {
      OutputFormat: 'mp3',
      Text: ssmlText,
      TextType: 'ssml',
      VoiceId: voiceId,
      Engine: 'long-form'
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
    } catch (e) {
      console.error('Polly SpeechMarks error:', e);
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
