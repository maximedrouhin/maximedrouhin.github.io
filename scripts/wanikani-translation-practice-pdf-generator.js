// Helper function to append status messages with color
function appendStatusMessage(statusElement, message, color = 'black') {
    const newMessage = document.createElement('span');
    newMessage.textContent = message;
    newMessage.style.color = color;
    statusElement.appendChild(newMessage);
    statusElement.appendChild(document.createElement('br'));  // Add a line break after each message
    statusElement.scrollTop = statusElement.scrollHeight; // Scroll to the latest message
}

// Main event listener for the form submission
document.getElementById("wanikani-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const apiToken = document.getElementById("apiToken").value;
    const statusElement = document.getElementById("status");
    statusElement.innerHTML = ""; // Clear previous status messages
    appendStatusMessage(statusElement, "Fetching your current WaniKani level...", 'blue');

    try {
        // Fetch user's current level
        const level = await fetchCurrentLevel(apiToken, statusElement);

        // Fetch the IDs of vocabulary items that have been started (from levels 1 to currentLevel)
        appendStatusMessage(statusElement, "Fetching started vocabulary assignments...", 'blue');
        const startedVocabularyIds = await fetchStartedAssignments(apiToken, level, statusElement);

        // Fetch sentences for the started vocabulary items
        appendStatusMessage(statusElement, "Fetching example sentences...", 'blue');
        const [japaneseSentences, englishSentences] = await fetchVocabulary(apiToken, startedVocabularyIds, statusElement);

        // Generate and download the PDF with the fetched sentences
        appendStatusMessage(statusElement, "Generating PDF...", 'blue');
        await generatePDF(japaneseSentences);
        
        appendStatusMessage(statusElement, "PDF generated successfully and ready for download!", 'green');
    } catch (error) {
        console.error("Error:", error);
        appendStatusMessage(statusElement, `Error: ${error.message}`, 'red');
    }
});

/**
 * Helper function for making synchronous XMLHttpRequest calls.
 * @param {string} url - The URL to make the request to.
 * @param {string} apiToken - The API token to use in the request header.
 * @returns {Promise} - A promise that resolves with the XMLHttpRequest object.
 */
function makeSynchronousRequest(url, apiToken, statusElement) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false); // Make a synchronous request
        xhr.setRequestHeader('Authorization', `Bearer ${apiToken}`);
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                appendStatusMessage(statusElement, `Request to ${url} succeeded.`, 'green');
                resolve(xhr);
            } else {
                appendStatusMessage(statusElement, `Request to ${url} failed with status ${xhr.status}`, 'red');
                reject(new Error(`Request failed with status ${xhr.status}`));
            }
        };
        xhr.onerror = () => {
            appendStatusMessage(statusElement, `Network error when trying to reach ${url}`, 'red');
            reject(new Error('Network error occurred'));
        };
        appendStatusMessage(statusElement, `Sending request to ${url}...`, 'blue');
        xhr.send();
    });
}

/**
 * Fetches the current level of the user from the WaniKani API.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @returns {Promise<number>} - The current level of the user.
 */
async function fetchCurrentLevel(apiToken, statusElement) {
    try {
        const response = await makeSynchronousRequest("https://api.wanikani.com/v2/user", apiToken, statusElement);
        const data = JSON.parse(response.responseText);
        appendStatusMessage(statusElement, `Fetched current level: ${data.data.level}`, 'green');
        return data.data.level;
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch current level using the API token. Trying with another browser might be a good idea.", 'red');
        throw error;
    }
}

/**
 * Fetches the IDs of vocabulary items that are "started" for levels from 1 to the current level.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @param {number} currentLevel - The current level of the user.
 * @returns {Promise<number[]>} - A list of started vocabulary subject IDs.
 */
async function fetchStartedAssignments(apiToken, currentLevel, statusElement) {
    try {
        const startedVocabularyIds = [];
        const levels = Array.from({ length: currentLevel }, (_, i) => i + 1).join(',');
        let url = `https://api.wanikani.com/v2/assignments?subject_types=vocabulary&started=true&levels=${levels}`;

        // Loop through pages until there are no more
        while (url) {
            const response = await makeSynchronousRequest(url, apiToken, statusElement);
            const data = JSON.parse(response.responseText);
            startedVocabularyIds.push(...data.data.map(item => item.data.subject_id));
            url = data.pages.next_url; // Fetch next page if it exists
        }

        appendStatusMessage(statusElement, `Fetched ${startedVocabularyIds.length} started vocabulary assignments.`, 'green');
        return startedVocabularyIds;
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch started assignments.", 'red');
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
        let url = `https://api.wanikani.com/v2/subjects?types=vocabulary&ids=${startedVocabularyIds.join(",")}`;

        // Loop through the pages until no more results
        while (url) {
            const response = await makeSynchronousRequest(url, apiToken, statusElement);
            const data = JSON.parse(response.responseText);
            
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
        }

        appendStatusMessage(statusElement, `Fetched ${japaneseSentences.length} sentences.`, 'green');
        return [japaneseSentences, englishSentences];
    } catch (error) {
        appendStatusMessage(statusElement, "Failed to fetch example sentences.", 'red');
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

    // Set up the document title and formatting
    doc.setFontSize(16);
    doc.text("Japanese Sentence Translation Exercise", 20, 20);

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
    doc.save("WaniKani_Sentences.pdf");
}
