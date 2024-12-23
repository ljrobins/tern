let audioProcessingQueue = [];

async function generateAudioForInstruction(text) {
    try {
        const response = await fetch('/api/audiogen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error(`Error generating audio: ${response.statusText}`);
        }

        const data = await response.json();
        return data.audio_url; // Return the audio URL
    } catch (error) {
        console.error('Error in generateAudioForInstruction:', error);
        return null; // Handle errors gracefully
    }
}

// Helper function to process the requests with a delay
async function processQueue() {
    // Handle the first request immediately (without delay)
    if (audioProcessingQueue.length > 0) {
        const firstRequest = audioProcessingQueue.shift();
        await handleAudioRequest(firstRequest.text, firstRequest.maneuver, firstRequest.key);

        // Process the rest of the requests with a delay to rate-limit
        for (let i = 0; i < audioProcessingQueue.length; i++) {
            await handleAudioRequest(audioProcessingQueue[i].text, audioProcessingQueue[i].maneuver, audioProcessingQueue[i].key);
            // Optional delay between requests (rate limiting)
            // await new Promise(resolve => setTimeout(resolve, 20)); // Adjust delay as needed
        }
    }
}

// Function to handle each individual audio request
async function handleAudioRequest(text, maneuver, key) {
    // Generate audio asynchronously
    const audioUrl = await generateAudioForInstruction(text);
    if (audioUrl) {
        // Update the maneuver with the generated audio
        const audio = new Audio(audioUrl);
        audio.load(); // Start loading the audio
        maneuver[key] = { text: text, audioUrl: audioUrl, audio: audio };
        // maneuver[key].audio.play(); // to make a lovely chorus
    }
}

async function cancelAudioGeneration(text) {
    try {
        const response = await fetch('/api/audiogen/cancelall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({  }),
        });

        const result = await response.json();
        console.log(`Cancellation: ${result.message}`);
    } catch (error) {
        console.error(`Error canceling audio generation for "${text}":`, error);
    }
}

async function processAudioForRouteIncrementally(route) {
    // Cancel pending requests before starting new ones
    await cancelAudioGeneration();

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

    // Process the new audio queue incrementally
    await processQueue();
}

async function sayPhrase(text) {
    try {
        // Generate the audio URL for the given phrase
        const audioUrl = await generateAudioForInstruction(text);

        if (audioUrl) {
            // Create an Audio object and play the audio
            const audio = new Audio(audioUrl);
            await audio.play(); // Wait for the audio to start playing
        } else {
            console.error('Failed to generate audio for the phrase.');
        }
    } catch (error) {
        console.error('Error in sayPhrase:', error);
    }
}