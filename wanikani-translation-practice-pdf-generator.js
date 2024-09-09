document.getElementById("wanikani-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const apiToken = document.getElementById("apiToken").value;
    const statusElement = document.getElementById("status");
    statusElement.textContent = "Fetching data from WaniKani...";

    try {
        const level = await fetchCurrentLevel(apiToken);
        const startedVocabularyIds = await fetchStartedAssignments(apiToken, level);
        const [japaneseSentences, englishSentences] = await fetchVocabulary(apiToken, startedVocabularyIds);

        await generatePDF(japaneseSentences);
        statusElement.textContent = "PDF generated and ready for download!";
    } catch (error) {
        console.error("Error fetching data:", error);
        statusElement.textContent = "Failed to fetch data or generate PDF.";
    }
});

async function fetchCurrentLevel(apiToken) {
    const response = await fetch("https://api.wanikani.com/v2/user", {
        headers: { Authorization: `Bearer ${apiToken}` }
    });
    const data = await response.json();
    return data.data.level;
}

async function fetchStartedAssignments(apiToken, currentLevel) {
    let startedVocabularyIds = [];
    // Construct the levels string dynamically (range of levels from 1 to currentLevel)
    let levels = Array.from({ length: currentLevel }, (_, i) => i + 1).join(',');
    let url = `https://api.wanikani.com/v2/assignments?subject_types=vocabulary&started=true&levels=${levels}`;

    while (url) {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
        const data = await response.json();
        startedVocabularyIds.push(...data.data.map(item => item.data.subject_id));
        url = data.pages.next_url;
    }

    return startedVocabularyIds;
}

async function fetchVocabulary(apiToken, startedVocabularyIds) {
    let japaneseSentences = [];
    let englishSentences = [];
    let url = `https://api.wanikani.com/v2/subjects?types=vocabulary&ids=${startedVocabularyIds.join(",")}`;

    while (url) {
        const response = await fetch(url, { 
            headers: { 
                Authorization: `Bearer ${apiToken}` 
            } 
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
        url = data.pages.next_url;
    }

    return [japaneseSentences, englishSentences];
}

// Helper function to load the font file and convert it to Base64
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

async function generatePDF(japaneseSentences) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Load the local font and embed it in the PDF
    const fontBase64 = await loadFontBase64('./fonts/NotoSansJP-Regular.ttf');
    doc.addFileToVFS("NotoSansJP-Regular.ttf", fontBase64);
    doc.addFont("NotoSansJP-Regular.ttf", "NotoSansJP", "normal");
    doc.setFont("NotoSansJP");

    doc.setFontSize(16);
    doc.text("Japanese Sentence Translation Exercise", 20, 20);

    let y = 40;
    doc.setFontSize(12);
    japaneseSentences.forEach((sentence, idx) => {
        if (y > 280) {  // Create a new page if necessary
            doc.addPage();
            y = 20;
        }
        doc.text(`${idx + 1}. ${sentence}`, 20, y);
        y += 12;
    });

    // Save the PDF
    doc.save("WaniKani_Sentences.pdf");
}
