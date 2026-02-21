// ═══════════════════════════════════════════════════════════════════
//  Job Application Assistant — Google Apps Script
//  ---------------------------------------------------------------
//  Before deploying, set these Script Properties
//  (Project Settings → Script Properties):
//
//    GEMINI_API_KEY    — your Gemini API key from AI Studio
//    CV_DOC_ID         — Google Doc ID of your base CV
//    OUTPUT_FOLDER_ID  — Google Drive folder ID for generated docs
// ═══════════════════════════════════════════════════════════════════

/* ---------- Web-app entry points ---------- */

/**
 * Handles GET requests (health-check / CORS preflight fallback).
 */
function doGet(e) {
  return _jsonResponse({ success: true, message: "Job Application Assistant API is running." });
}

/**
 * Handles POST requests from the GitHub Pages frontend.
 * Expects JSON body: { "url": "https://..." }
 */
function doPost(e) {
  try {
    // 1. Parse input
    var body = JSON.parse(e.postData.contents);
    var jobUrl = (body.url || "").trim();

    if (!jobUrl) {
      return _jsonResponse({ success: false, error: "No URL provided." });
    }

    if (!/^https?:\/\/.+/i.test(jobUrl)) {
      return _jsonResponse({ success: false, error: "Invalid URL format." });
    }

    // 2. Extract job description text from the URL
    var jobText = extractJobDescription(jobUrl);
    if (!jobText || jobText.length < 50) {
      return _jsonResponse({
        success: false,
        error: "Could not extract meaningful text from the URL. The site may block automated access."
      });
    }

    // 3. Read base CV
    var cvText = getBaseCvText();

    // 4. Call Gemini AI
    var aiResult = callGemini(jobText, cvText);

    // 5. Save generated docs to Google Drive
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty("OUTPUT_FOLDER_ID");
    var roleName = aiResult.roleName || "Job Application";

    var cvDocUrl = saveToGoogleDrive(
      "Tailored CV — " + roleName,
      aiResult.tailoredCv,
      folderId
    );

    var clDocUrl = saveToGoogleDrive(
      "Cover Letter — " + roleName,
      aiResult.coverLetter,
      folderId
    );

    // 6. Return success with both doc links
    return _jsonResponse({
      success: true,
      data: {
        role: roleName,
        cvUrl: cvDocUrl,
        coverLetterUrl: clDocUrl
      }
    });

  } catch (err) {
    console.error("doPost error:", err);
    return _jsonResponse({ success: false, error: err.message || "An unexpected error occurred." });
  }
}


/* ---------- URL text extraction ---------- */

/**
 * Fetches the given URL and extracts visible text from the HTML.
 * @param {string} url
 * @returns {string} extracted plain text
 */
function extractJobDescription(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; JobAppAssistant/1.0)"
    }
  });

  var code = response.getResponseCode();
  if (code < 200 || code >= 400) {
    throw new Error("Failed to fetch URL (HTTP " + code + ").");
  }

  var html = response.getContentText();

  // Try to isolate <body> content
  var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  var content = bodyMatch ? bodyMatch[1] : html;

  // Remove script and style blocks
  content = content.replace(/<script[\s\S]*?<\/script>/gi, " ");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, " ");
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  // Strip remaining HTML tags
  content = content.replace(/<[^>]*>/g, " ");

  // Decode common HTML entities
  content = content.replace(/&amp;/g, "&");
  content = content.replace(/&lt;/g, "<");
  content = content.replace(/&gt;/g, ">");
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&nbsp;/g, " ");

  // Collapse whitespace
  content = content.replace(/\s+/g, " ").trim();

  // Cap at ~15000 chars to keep tokens manageable
  if (content.length > 15000) {
    content = content.substring(0, 15000);
  }

  return content;
}


/* ---------- CV reader ---------- */

/**
 * Reads the base CV text from a Google Doc.
 * @returns {string} plain text of the CV
 */
function getBaseCvText() {
  var props = PropertiesService.getScriptProperties();
  var docId = props.getProperty("CV_DOC_ID");

  if (!docId) {
    throw new Error("CV_DOC_ID is not set in Script Properties.");
  }

  var doc = DocumentApp.openById(docId);
  var text = doc.getBody().getText();

  if (!text || text.trim().length < 20) {
    throw new Error("The base CV document appears to be empty.");
  }

  return text;
}


/* ---------- Gemini AI ---------- */

/**
 * Calls Gemini 2.5 Flash to generate a tailored CV and cover letter.
 * @param {string} jobDescription - extracted job posting text
 * @param {string} cvText - the user's base CV text
 * @returns {Object} { roleName, tailoredCv, coverLetter }
 */
function callGemini(jobDescription, cvText) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in Script Properties.");
  }

  var model = "gemini-2.5-flash";
  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/"
    + model + ":generateContent?key=" + apiKey;

  var systemPrompt = [
    "You are a professional career consultant and CV writer.",
    "Your job is to tailor a candidate's existing CV and write a compelling cover letter",
    "to perfectly match a given job description.",
    "",
    "RULES:",
    "- Preserve all factual information from the original CV (dates, companies, degrees).",
    "- Reorder, rephrase, and emphasise bullet points to align with the job requirements.",
    "- Add relevant keywords from the job description naturally.",
    "- The cover letter should be formal, concise (max 400 words), and addressed to 'Hiring Manager'.",
    "- Do NOT invent experience or skills the candidate does not have.",
    "",
    "IMPORTANT: Respond ONLY with valid JSON — no markdown, no code fences, no extra text.",
    "The JSON must have exactly these three keys:",
    '  "roleName" — a short name for the role (e.g. "Senior Data Engineer at Google")',
    '  "tailoredCv" — the full tailored CV as plain text with line breaks',
    '  "coverLetter" — the full cover letter as plain text with line breaks'
  ].join("\n");

  var userPrompt = [
    "=== CANDIDATE'S CURRENT CV ===",
    cvText,
    "",
    "=== JOB DESCRIPTION ===",
    jobDescription,
    "",
    "Now generate the tailored CV and cover letter. Respond with JSON only."
  ].join("\n");

  var payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          roleName: { type: "STRING" },
          tailoredCv: { type: "STRING" },
          coverLetter: { type: "STRING" }
        },
        required: ["roleName", "tailoredCv", "coverLetter"]
      }
    }
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(endpoint, options);
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (code !== 200) {
    var errMsg = (body.error && body.error.message) || "Gemini API error (HTTP " + code + ")";
    throw new Error(errMsg);
  }

  // Extract the generated text from Gemini response
  var generatedText = body.candidates[0].content.parts[0].text;
  var result = JSON.parse(generatedText);

  if (!result.tailoredCv || !result.coverLetter) {
    throw new Error("Gemini returned an incomplete response.");
  }

  return result;
}


/* ---------- Google Drive / Docs ---------- */

/**
 * Creates a Google Doc with the given content and moves it to a folder.
 * @param {string} title - document title
 * @param {string} content - plain text content
 * @param {string} folderId - destination folder ID
 * @returns {string} URL of the created document
 */
function saveToGoogleDrive(title, content, folderId) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();

  // Clear default empty paragraph
  body.clear();

  // Split content into paragraphs and add them
  var paragraphs = content.split(/\n/);
  for (var i = 0; i < paragraphs.length; i++) {
    var line = paragraphs[i];

    if (i === 0 && line.trim().length > 0) {
      // First line as title heading
      body.appendParagraph(line)
        .setHeading(DocumentApp.ParagraphHeading.HEADING1)
        .setSpacingBefore(0);
    } else if (line.trim().length === 0) {
      body.appendParagraph("");
    } else {
      body.appendParagraph(line);
    }
  }

  doc.saveAndClose();

  // Move to target folder
  if (folderId) {
    var file = DriveApp.getFileById(doc.getId());
    var folder = DriveApp.getFolderById(folderId);
    file.moveTo(folder);
  }

  return doc.getUrl();
}


/* ---------- Helpers ---------- */

/**
 * Returns a JSON ContentService response (handles CORS via GAS redirect).
 */
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ---------- Manual test function ---------- */

/**
 * Run this from the Apps Script editor to test end-to-end
 * without deploying. Replace the URL with a real job posting.
 */
function testDoPost() {
  var mockEvent = {
    postData: {
      contents: JSON.stringify({
        url: "https://example.com/careers/software-engineer"
      })
    }
  };

  var result = doPost(mockEvent);
  console.log(result.getContent());
}
