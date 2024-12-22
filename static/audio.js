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

async function processAudioForRouteIncrementally(route) {
    // Create a queue for processing the audio requests
    const audioQueue = [];
    
    // Push all audio requests into the queue, with the first one prioritized
    route.legs.forEach((leg) => {
        leg.maneuvers.forEach((maneuver) => {
            Object.keys(maneuver).forEach((key) => {
                if (key.endsWith('instruction') && typeof maneuver[key] === 'string') {
                    const text = maneuver[key];
                    audioQueue.push({ text, maneuver, key });
                }
            });
        });
    });

    // Helper function to process the requests with a delay
    async function processQueue() {
        // Handle the first request immediately (without delay)
        if (audioQueue.length > 0) {
            const firstRequest = audioQueue.shift();
            await handleAudioRequest(firstRequest.text, firstRequest.maneuver, firstRequest.key);

            // Process the rest of the requests with a delay to rate-limit
            for (let i = 0; i < audioQueue.length; i++) {
                await handleAudioRequest(audioQueue[i].text, audioQueue[i].maneuver, audioQueue[i].key);
                // Optional delay between requests (rate limiting)
                await new Promise(resolve => setTimeout(resolve, 20)); // Adjust delay as needed
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

    // Start processing the queue
    await processQueue();
}