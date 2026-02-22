// ═══════════════════════════════════════════════════════════════
//  TEST: Extract job description from a URL
//  ---------------------------------------------------------------
//  Uses the same extraction logic as your main code.
//  Set the URL below to any job posting you want to test.
// ═══════════════════════════════════════════════════════════════

function testExtractJobDescription() {
  // Replace with a real job description URL to test
  var url = "https://example.com/job-description";
  try {
    var jobText = extractJobDescription(url); // Uses your main code's extraction logic
    console.log("✅ Extracted job description (" + jobText.length + " chars):");
    console.log("---");
    console.log(jobText.substring(0, 2000)); // Print first 2000 chars for review
    if (jobText.length > 2000) console.log("...truncated...");
    console.log("---");
  } catch (err) {
    console.log("❌ Extraction failed: " + err.message);
  }
}
