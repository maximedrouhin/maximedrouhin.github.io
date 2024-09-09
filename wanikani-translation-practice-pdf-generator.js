// Main event listener for the form submission
document.getElementById("wanikani-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const apiToken = document.getElementById("apiToken").value;
    const statusElement = document.getElementById("status");
    statusElement.textContent = "Fetching data from WaniKani...";

    try {
        // Fetch user's current level
        const level = await fetchCurrentLevel(apiToken);

        // Fetch the IDs of vocabulary items that have been started (from levels 1 to currentLevel)
        const startedVocabularyIds = await fetchStartedAssignments(apiToken, level);

        // Fetch sentences for the started vocabulary items
        const [japaneseSentences, englishSentences] = await fetchVocabulary(apiToken, startedVocabularyIds);

        // Generate and download the PDF with the fetched sentences
        await generatePDF(japaneseSentences);
        
        statusElement.textContent = "PDF generated and ready for download!";
    } catch (error) {
        console.error("Error fetching data:", error);
        statusElement.textContent = "Failed to fetch data or generate PDF.";
    }
});

/**
 * Fetches the current level of the user from the WaniKani API.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @returns {Promise<number>} - The current level of the user.
 */
async function fetchCurrentLevel(apiToken) {
    const response = await fetch("https://api.wanikani.com/v2/user", {
        headers: { Authorization: `Bearer ${apiToken}` }
    });
    const data = await response.json();
    return data.data.level;
}

/**
 * Fetches the IDs of vocabulary items that are "started" for levels from 1 to the current level.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @param {number} currentLevel - The current level of the user.
 * @returns {Promise<number[]>} - A list of started vocabulary subject IDs.
 */
async function fetchStartedAssignments(apiToken, currentLevel) {
    const startedVocabularyIds = [];
    const levels = Array.from({ length: currentLevel }, (_, i) => i + 1).join(','); // Generate levels string (e.g., '1,2,...,currentLevel')
    let url = `https://api.wanikani.com/v2/assignments?subject_types=vocabulary&started=true&levels=${levels}`;

    // Loop through pages until there are no more
    while (url) {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
        const data = await response.json();
        startedVocabularyIds.push(...data.data.map(item => item.data.subject_id));
        url = data.pages.next_url; // Fetch next page
    }

    return startedVocabularyIds;
}

/**
 * Fetches example sentences for the given vocabulary subject IDs.
 * Only sentences with up to 40 Japanese characters are included.
 * @param {string} apiToken - WaniKani API token provided by the user.
 * @param {number[]} startedVocabularyIds - List of started vocabulary subject IDs.
 * @returns {Promise<[string[], string[]]>} - A tuple containing two arrays: Japanese sentences and their English translations.
 */
async function fetchVocabulary(apiToken, startedVocabularyIds) {
    const japaneseSentences = [];
    const englishSentences = [];
    let url = `https://api.wanikani.com/v2/subjects?types=vocabulary&ids=${startedVocabularyIds.join(",")}`;

    // Loop through the pages until no more results
    while (url) {
        const response = await fetch(url, { 
            headers: { Authorization: `Bearer ${apiToken}` } 
        });
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
    }

    return [japaneseSentences, englishSentences];
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
    const fontBase64 = await loadFontBase64('./fonts/NotoSansJP-Regular.ttf');
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
