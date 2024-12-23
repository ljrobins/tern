let audioProcessingQueue = [];

async function generateAudioForInstructions(texts) {
    try {
        const response = await fetch('/api/audiogen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts }), // Send all texts as an array
        });

        if (!response.ok) {
            throw new Error(`Error generating audio: ${response.statusText}`);
        }

        const data = await response.json();
        return data.audio_urls; // Return the array of audio URLs
    } catch (error) {
        console.error('Error in generateAudioForInstructions:', error);
        return null; // Handle errors gracefully
    }
}

// Cache to store audio data for already processed texts
const audioCache = {};

// Helper function to process the queue in batches
async function processQueue() {
    if (audioProcessingQueue.length === 0) {
        return; // Nothing to process
    }

    // Prepare lists of unique texts and map them
    const uniqueTexts = [];
    const requestMap = {};

    audioProcessingQueue.forEach((req, index) => {
        if (!audioCache[req.text]) {
            // If the text is not in the cache, queue it for generation
            if (!requestMap[req.text]) {
                uniqueTexts.push(req.text); // Add only unique texts for processing
                requestMap[req.text] = [];
            }
            requestMap[req.text].push({ index, maneuver: req.maneuver, key: req.key });
        } else {
            // If the text is already in the cache, clone the cached audio
            const cachedAudio = audioCache[req.text];

            // Create a new Audio element using the same audioUrl to ensure it behaves independently
            const copiedAudio = new Audio(cachedAudio.audioUrl);
            copiedAudio.load(); // Start loading the new audio element
            req.maneuver[req.key] = { text: req.text, audioUrl: cachedAudio.audioUrl, audio: copiedAudio };
        }
    });

    if (uniqueTexts.length > 0) {
        // Generate audio for all unique texts in one batch
        const audioUrls = await generateAudioForInstructions(uniqueTexts);

        if (audioUrls) {
            audioUrls.forEach((audioUrl, index) => {
                if (audioUrl) {
                    const text = uniqueTexts[index];
                    const requests = requestMap[text];

                    // Cache the audio data (keep the audioUrl and audio)
                    const audio = new Audio(audioUrl);
                    audio.load(); // Start loading the audio
                    audioCache[text] = { audioUrl, audio };

                    // Update all maneuvers with the generated audio
                    requests.forEach(({ maneuver, key }) => {
                        maneuver[key] = { text, audioUrl, audio };
                    });
                }
            });
        } else {
            console.error('Failed to generate audio for some or all unique texts.');
        }
    }

    // Clear the queue after processing
    audioProcessingQueue = [];
}

async function processAudioForRouteIncrementally(route) {
    // Reset the audio queue for the new route
    audioProcessingQueue = [];

    // Push all audio requests into the queue
    route.legs.forEach((leg) => {
        leg.maneuvers.forEach((maneuver) => {
            Object.keys(maneuver).forEach((key) => {
                if (key.endsWith('instruction') && typeof maneuver[key] === 'string') {
                    const text = maneuver[key];
                    audioProcessingQueue.push({ text, maneuver, key });
                }
            });
        });
    });

    // Process the audio queue in a batch
    await processQueue();
}

async function sayPhrase(text) {
    try {
        // Generate the audio URL for the given phrase
        const audioUrls = await generateAudioForInstructions([text]);

        if (audioUrls && audioUrls[0]) {
            // Create an Audio object and play the audio
            const audio = new Audio(audioUrls[0]);
            await audio.play(); // Wait for the audio to start playing
        } else {
            console.error('Failed to generate audio for the phrase.');
        }
    } catch (error) {
        console.error('Error in sayPhrase:', error);
    }
}
