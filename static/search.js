const apiUrl = "/api/search";
const resultsContainer = document.getElementById('results');

async function performSearch(event) {
    const query = event.target.value.trim();
    if (!query) {
        resultsContainer.innerHTML = ""; // Clear results when input is empty
        return;
    }

    // Construct the API URL with query parameters
    const url = `${apiUrl}?q=${encodeURIComponent(query)}&lat=${userMarker.getLngLat().lat}&lon=${userMarker.getLngLat().lng}&limit=5`;

    try {
        // Fetch the API response
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error: ${response.statusText}`);
        }

        const data = await response.json();

        // Render the results
        console.log(data.features);
        renderResults(data.features);
    } catch (error) {
        console.error('Error performing search:', error);
        resultsContainer.innerHTML = `<div class="result">Error fetching results</div>`;
    }
}

function renderResults(features) {
    resultsContainer.innerHTML = features.map(feature => `
                <div class="result">
                    <div class="result-title">${feature.properties.name || 'Unnamed Location'}</div>
                    <div class="result-details">
                        <strong>Address:</strong> ${feature.properties.housenumber || ''} ${feature.properties.street || 'N/A'}<br>
                        <strong>City:</strong> ${feature.properties.city || 'N/A'}<br>
                        <strong>State:</strong> ${feature.properties.state || 'N/A'}<br>
                        <strong>Country:</strong> ${feature.properties.country || 'N/A'}
                    </div>
                </div>
            `).join('');
}
