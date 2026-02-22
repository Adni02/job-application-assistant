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
    var jdText = (body.jd || "").trim();
    if (!jdText || jdText.length < 30) {
      return _jsonResponse({ success: false, error: "No job description text provided." });
    }

    // 2. Extract concise signals from JD using Gemini
    var signals = extractJDSignals(jdText);

    // 3. Read base CV
    var cvText = getBaseCvText();

    // 4. Call Gemini AI for CV/cover letter, passing signals and CV
    var aiResult = callGeminiWithSignals(signals, cvText);

    // 5. Save generated docs to Google Drive
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty("OUTPUT_FOLDER_ID");
    var roleName = signals.t || aiResult.roleName || "Job Application";

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
        coverLetterUrl: clDocUrl,
        signals: signals // include signals for debugging
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
 * Calls Gemini to extract concise hiring signals from JD text.
 * Returns minified JSON with keys: c, t, rt, p, mh, nh, r, kpi, ats
 */
function extractJDSignals(jdText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var systemInstruction = [
    "You are an expert CV tailoring assistant. Extract concise hiring signals from a job description for targeted resume optimization. Output ONLY valid minified JSON, no markdown, no explanations. Use EXACT keys and structure:",
    '{"c":"","t":"","rt":"","p":[],"mh":[],"nh":[],"r":[],"kpi":[],"ats":[]}',
    "FIELD RULES:",
    "- c: company name (\"\" if not present)",
    "- t: role/job title",
    "- rt: short role type classification (e.g., 'Technical Product Owner – E-Invoicing')",
    "- p: ranked top 5 hiring priorities (max 5, most important first)",
    "- mh: must-have skills/knowledge (max 10)",
    "- nh: nice-to-have skills/tools (max 7)",
    "- r: core responsibilities (max 7, start with strong verbs)",
    "- kpi: success metrics (max 6). If none explicit, infer up to 3 likely KPIs based on the JD (keep generic but role-specific).",
    "- ats: ATS keywords (max 30). Include standards, tools, platforms, protocols, domain terms. Exclude generic soft skills.",
    "CONCISENESS RULES:",
    "- Each list item must be <= 8 words.",
    "- Deduplicate and normalize terms (e.g., 'EN16931' -> 'EN 16931'; 'PEPPOL BIS' keep as is).",
    "- Do NOT include location, hybrid policy, benefits, contact person, or marketing text.",
    "- Avoid filler words (e.g., 'collaboration', 'ownership') unless explicitly a requirement."
  ].join("\n");

  var userPrompt = [
    "Extract concise hiring signals from the following job description. Output ONLY valid minified JSON with the exact keys and structure specified. No explanations.",
    "=== JD START ===",
    jdText,
    "=== JD END ==="
  ].join("\n");

  var payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          c: { type: "STRING" },
          t: { type: "STRING" },
          rt: { type: "STRING" },
          p: { type: "ARRAY", items: { type: "STRING" } },
          mh: { type: "ARRAY", items: { type: "STRING" } },
          nh: { type: "ARRAY", items: { type: "STRING" } },
          r: { type: "ARRAY", items: { type: "STRING" } },
          kpi: { type: "ARRAY", items: { type: "STRING" } },
          ats: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["c", "t", "rt", "p", "mh", "nh", "r", "kpi", "ats"]
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

  var resultText = body.candidates[0].content.parts[0].text;
  var signals = JSON.parse(resultText);
  return signals;
}

/**
 * Calls Gemini to generate tailored CV and cover letter using signals and CV text.
 * @param {Object} signals - concise JD signals
 * @param {string} cvText - base CV text
 * @returns {Object} { tailoredCv, coverLetter }
 */
function callGeminiWithSignals(signals, cvText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var systemPrompt = [
    "You are a professional CV and cover letter writer.",
    "Use the provided concise hiring signals and candidate CV to generate a tailored CV and cover letter.",
    "Focus ONLY on the signals provided. Do not add unrelated content.",
    "Respond ONLY with valid JSON: {tailoredCv, coverLetter}"
  ].join("\n");

  var userPrompt = [
    "=== HIRING SIGNALS ===",
    JSON.stringify(signals),
    "",
    "=== CANDIDATE CV ===",
    cvText,
    "",
    "Generate a tailored CV and cover letter for this role. Respond with JSON only."
  ].join("\n");

  var payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          tailoredCv: { type: "STRING" },
          coverLetter: { type: "STRING" }
        },
        required: ["tailoredCv", "coverLetter"]
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

  var resultText = body.candidates[0].content.parts[0].text;
  var result = JSON.parse(resultText);

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
 * without deploying. Replace the JD text with a real job description.
 */
function testDoPost() {
  var mockEvent = {
    postData: {
      contents: JSON.stringify({
        jd: "Senior Software Engineer\n\nWe are seeking a Senior Software Engineer to join our team. Responsibilities include designing scalable systems, collaborating with cross-functional teams, and ensuring code quality. Must have experience with cloud platforms, REST APIs, and agile methodologies. Nice-to-have: DevOps tools, machine learning exposure. Success measured by project delivery, code quality, and system uptime."
      })
    }
  };

  var result = doPost(mockEvent);
  console.log(result.getContent());
}
