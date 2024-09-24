// Helper function to append status messages with color
function appendStatusMessage(statusElement, message, color = 'var(--terminal-text-color)') {
    statusElement.style.padding = '10px';
    // statusElement.style.margin = '10px auto';
    statusElement.style.marginTop = '15px';
    const newMessage = document.createElement('span');
    newMessage.textContent = message;
    newMessage.style.color = color;
    statusElement.appendChild(newMessage);
    statusElement.appendChild(document.createElement('br'));  // Add a line break after each message
    statusElement.scrollTop = statusElement.scrollHeight; // Scroll to the latest message
}

// Helper function to handle rate limit and retry requests
async function handleRateLimit(response, statusElement) {
    if (response.status === 429) {
        const resetTime = parseInt(response.headers.get('RateLimit-Reset'), 10);
        const currentTime = Math.floor(Date.now() / 1000);
        const waitTime = resetTime - currentTime;

        appendStatusMessage(statusElement, `Rate limit exceeded. Waiting ${waitTime} seconds to retry...`, 'var(--warning-color)');

        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        return true; // Indicates retry needed
    }
    return false; // No retry needed
}

// Helper function to handle API errors and display meaningful messages
async function handleApiErrors(response, statusElement) {
    if (!response.ok) {
        const errorData = await response.json(); // Parse the error response
        const errorMessage = errorData.error || "Unknown error occurred"; // Extract error message if available
        const errorCode = response.status;
        appendStatusMessage(statusElement, `API Error: ${errorCode} - ${errorMessage}`, 'var(--error-color)');
        throw new Error(`API Error: ${errorCode} - ${errorMessage}`);
    }
}

// Main event listener for the form submission
document.getElementById("wanikani-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const apiToken = document.getElementById("apiToken").value;
    const statusElement = document.getElementById("status");
    statusElement.innerHTML = ""; // Clear previous status messages
    appendStatusMessage(statusElement, "Fetching your current WaniKani level...", 'var(--info-color)');

    // appendStatusMessage(statusElement, "test default");
    // appendStatusMessage(statusElement, "test red", 'var(--error-color)');
    // appendStatusMessage(statusElement, "test orange", 'var(--warning-color)');

    try {
        // Fetch user's current level
        const currentLevel = await fetchCurrentLevel(apiToken, statusElement);

        // Fetch the IDs of vocabulary items that have been started (from level 1 to currentLevel)
        appendStatusMessage(statusElement, "Fetching started vocabulary assignments...", 'var(--info-color)');
        const startedVocabularyIds = await fetchStartedAssignments(apiToken, currentLevel, statusElement);

        // Fetch sentences for the started vocabulary items
        appendStatusMessage(statusElement, "Fetching example sentences...", 'var(--info-color)');
        const [japaneseSentences, englishSentences] = await fetchVocabulary(apiToken, startedVocabularyIds, statusElement);

        // Generate and download the PDF with the fetched sentences
        appendStatusMessage(statusElement, "Generating PDF...", 'var(--info-color)');
        await generatePDF(japaneseSentences);

        appendStatusMessage(statusElement, "PDF generated successfully and ready for download!", 'var(--success-color)');
    } catch (error) {
        console.error("Error:", error);
        appendStatusMessage(statusElement, `Error: ${error.message}`, 'var(--error-color)');
    }
});

/**
 * Fetches the current level of the user from the WaniKani API.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @returns {Promise<number>} - The current level of the user.
 */
async function fetchCurrentLevel(apiToken, statusElement) {
    try {
        let response;
        do {
            response = await fetch("https://api.wanikani.com/v2/user", {
                headers: { Authorization: `Bearer ${apiToken}` }
            });

            if (await handleRateLimit(response, statusElement)) continue;

            await handleApiErrors(response, statusElement);
            const data = await response.json();
            appendStatusMessage(statusElement, `Fetched current level: ${data.data.level}`, 'var(--success-color)');
            return data.data.level;
        } while (true);
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch current level using the API token. Trying with another browser might be a good idea.", 'var(--error-color)');
        throw error;
    }
}

/**
 * Fetches the IDs of vocabulary items that are "started" for levels from 1 to the current level.
 */
async function fetchStartedAssignments(apiToken, currentLevel, statusElement) {
    try {
        const startedVocabularyIds = [];
        const levels = Array.from({ length: currentLevel }, (_, i) => i + 1).join(',');
        let url = `https://api.wanikani.com/v2/assignments?subject_types=vocabulary&started=true&levels=${levels}`;

        // Loop through pages until there are no more
        while (url) {
            let response;
            do {
                response = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
                if (await handleRateLimit(response, statusElement)) continue;

                await handleApiErrors(response, statusElement);
                const data = await response.json();
                startedVocabularyIds.push(...data.data.map(item => item.data.subject_id));
                url = data.pages.next_url; // Fetch next page
            } while (response.status === 429);
        }

        appendStatusMessage(statusElement, `Fetched ${startedVocabularyIds.length} started vocabulary assignments.`, 'var(--success-color)');
        return startedVocabularyIds;
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch started assignments.", 'var(--error-color)');
        throw error;
    }
}

/**
 * Fetches example sentences for the given vocabulary subject IDs.
 * Only sentences with up to 40 Japanese characters are included.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @param {number[]} startedVocabularyIds - List of started vocabulary subject IDs.
 * @returns {Promise<[string[], string[]]>} - A tuple containing two arrays: Japanese sentences and their English translations.
 */
async function fetchVocabulary(apiToken, startedVocabularyIds, statusElement) {
    try {
        const japaneseSentences = [];
        const englishSentences = [];
        
        // Split the IDs into chunks of 500 to avoid overly long URLs
        // 6662/500 = 13.324, so we will need at most 14 requests
        const chunkSize = 500;
        const idChunks = [];

        for (let i = 0; i < startedVocabularyIds.length; i += chunkSize) {
            idChunks.push(startedVocabularyIds.slice(i, i + chunkSize));
        }

        const totalChunks = idChunks.length;
        for (let i = 0; i < totalChunks; i++) {
            const chunk = idChunks[i];
            appendStatusMessage(statusElement, `\u00A0\u00A0Fetching chunk ${i + 1} of ${totalChunks}...`, 'var(--info-color)');

            let url = `https://api.wanikani.com/v2/subjects?types=vocabulary&ids=${chunk.join(",")}`;

            // Loop through the pages until no more results
            while (url) {
                let response;
                do {
                    response = await fetch(url, {
                        headers: { Authorization: `Bearer ${apiToken}` }
                    });

                    if (await handleRateLimit(response, statusElement)) continue;

                    await handleApiErrors(response, statusElement);
                    const data = await response.json();

                    data.data.forEach(item => {
                        if (item.data.context_sentences) {
                            item.data.context_sentences.forEach(sentence => {
                                // Only include sentences with 40 or fewer Japanese characters
                                if (sentence.ja.length <= 40) {
                                    japaneseSentences.push(sentence.ja);
                                    englishSentences.push(sentence.en);
                                }
                            });
                        }
                    });

                    url = data.pages.next_url; // Move to the next page if exists
                } while (response.status === 429);
            }
        }

        appendStatusMessage(statusElement, `Fetched ${japaneseSentences.length} sentences.`, 'var(--success-color)');
        return [japaneseSentences, englishSentences];
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch example sentences.", 'var(--error-color)');
        throw error;
    }
}

/**
 * Converts a font file to Base64 format to embed in the PDF.
 * @param {string} url - The URL or local path to the font file.
 * @returns {Promise<string>} - The Base64 encoded string of the font file.
 */
async function loadFontBase64(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Generates a PDF containing the provided Japanese sentences.
 * The font is loaded and embedded into the PDF, and each sentence is placed on a new line.
 * @param {string[]} japaneseSentences - Array of Japanese sentences to include in the PDF.
 */
async function generatePDF(japaneseSentences) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Load and embed the font into the PDF
    const fontBase64 = await loadFontBase64('/assets/fonts/NotoSansJP-Regular.ttf');
    doc.addFileToVFS("NotoSansJP-Regular.ttf", fontBase64);
    doc.addFont("NotoSansJP-Regular.ttf", "NotoSansJP", "normal");
    doc.setFont("NotoSansJP");

    // Store the number of sentences
    const numSentences = japaneseSentences.length;

    // Set up the document title and formatting
    doc.setFontSize(16);
    doc.text(`Japanese - Translation practice sheet (${numSentences} sentences)`, 20, 20);

    let y = 40;  // Initial Y position for sentence placement
    doc.setFontSize(12);

    // Add each sentence to the PDF
    japaneseSentences.forEach((sentence, idx) => {
        if (y > 280) {  // If we exceed the page height, create a new page
            doc.addPage();
            y = 20;
        }
        doc.text(`${idx + 1}. ${sentence}`, 20, y);
        y += 12;  // Move down to the next line
    });

    // Save the PDF to the user's device
    doc.save(`Japanese - Translation practice sheet (${numSentences} sentences).pdf`);
}
