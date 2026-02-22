// ═══════════════════════════════════════════════════════════════
//  TEST: Extract structured info from pasted JD text using Gemini
//  ---------------------------------------------------------------
//  Paste the JD text below. This function will call Gemini to extract:
//    - Company
//    - Role
//    - Required skills
//    - Company values (for cover letter)
//    - Responsibilities
//    - ATS keywords
//  Then you can use this structured info for targeted CV/cover letter generation.
// ═══════════════════════════════════════════════════════════════

function testExtractJDInfo() {
  // Paste the full JD text here
  var jdText = `Paste the job description text here`;

  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var prompt = [
    "Extract the following information from the job description below:",
    "- Company name (if present)",
    "- Role/Job title",
    "- Required skills (as a list)",
    "- Company values or mission (for cover letter)",
    "- Key responsibilities (as a list)",
    "- ATS keywords (as a comma-separated list of important terms for resume screening)",
    "",
    "Return ONLY valid JSON with these keys: company, role, skills, values, responsibilities, ats_keywords.",
    "",
    "=== JOB DESCRIPTION START ===",
    jdText,
    "=== JOB DESCRIPTION END ==="
  ].join("\n");

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          company: { type: "STRING" },
          role: { type: "STRING" },
          skills: { type: "ARRAY", items: { type: "STRING" } },
          values: { type: "STRING" },
          responsibilities: { type: "ARRAY", items: { type: "STRING" } },
          ats_keywords: { type: "STRING" }
        },
        required: ["company", "role", "skills", "values", "responsibilities", "ats_keywords"]
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

  console.log("✅ Extracted info from JD:");
  console.log(JSON.stringify(result, null, 2));
  // You can now use result.company, result.role, etc. for the next AI step
}

function testExtractJDSignals() {
  // Paste the full JD text here
  var jdText = `Paste the job description text here`;

  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in Script Properties.");

  var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  // SYSTEM INSTRUCTION
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

  // USER PROMPT
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
  var result = JSON.parse(resultText);

  console.log("✅ Concise hiring signals from JD:");
  console.log(JSON.stringify(result)); // Minified JSON
  // Use result.c, result.t, etc. for CV tailoring
}
