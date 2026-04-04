const { getProvider } = require("./providers");

const SYSTEM_PROMPT = `You are an expert content writer and job data extractor for CareersAt.Tech, an Indian tech job portal for freshers.

You will receive raw scraped content from a job posting page. Extract, rewrite, and structure the data into a valid JSON object.

IMPORTANT: Return ONLY valid JSON. No markdown, no code blocks, no explanations. Do NOT add or assume any information beyond the provided job details except for salary estimation and company enrichment.

OUTPUT JSON KEYS (use ONLY these keys):
{
  "title": "string (required) — clean job title",
  "link": "string (required) — company careers page apply URL, NOT the aggregator URL",
  "jdpage": "string or null — job description page URL if different from link",
  "companyName": "string (required) — company name",
  "role": "string — specific role, e.g. 'Software Engineer', 'Data Analyst'",
  "jobdesc": "string (required) — rewritten job description, 100-160 words. MUST start with '[Company name] is hiring' or '[Company name] is seeking'. Write in simple, clear, SEO-friendly language. No redundancy. Fresher-friendly tone.",
  "eligibility": "string — HTML list format: <ul><li>...</li></ul>. Max 5 points. Combine shorter points. Include academic and other eligibility criteria.",
  "responsibility": "string — HTML list format: <ul><li>...</li></ul>. Max 5 points. Combine shorter points. Key responsibilities of the role.",
  "benefits": "string — HTML list format: <ul><li>...</li></ul>. Max 5 points. Combine shorter points. Perks and benefits.",
  "skills": "string — HTML list format: <ul><li>...</li></ul>. Max 5 points. Include BOTH technical skills AND professional/soft skills.",
  "skilltags": "array of strings — ONLY technical skills, max 10. e.g. ['javascript', 'python', 'react', 'sql']. Lowercase.",
  "degree": "string — use closest match from: 'B.E / B.Tech / M.Tech / MCA / BCA', 'B.E / B.Tech', 'Any Graduate', 'B.Sc / M.Sc', 'MBA', 'BCA / MCA', 'Diploma'. Pick closest option.",
  "batch": "string — graduation years, e.g. '2024', '2023 / 2024 / 2025'. Use closest match format.",
  "experience": "string — use closest match from: 'Freshers', '0-1 years', '1-3 years', '3-5 years', '5+ years'",
  "location": "string — use closest match from: 'Bangalore', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi NCR', 'Gurgaon', 'Noida', 'Kolkata', 'Remote', 'Hybrid'. Normalize: Bengaluru→Bangalore, Gurugram→Gurgaon, NCR→Delhi NCR. Multiple comma-separated.",
  "salary": "string — format as ₹5LPA or ₹5LPA – ₹12LPA. If not found, ESTIMATE based on company tier and role (see rules). Always provide a value.",
  "salaryRange": "object — { from: number, to: number } in LPA. Must always have a value (estimate if needed).",
  "stipend": "number or null — monthly stipend in INR for internships only, null for full-time",
  "lastdate": "string or null — application deadline if mentioned",
  "jobtype": "string — one of: 'Full time', 'Internship', 'Part time', 'Contractual'",
  "workMode": "string — one of: 'onsite', 'hybrid', 'remote'. Default 'onsite' if unclear.",
  "companytype": "string — one of: 'Product based', 'Service based', 'Agency', 'Promotion', 'Others'. Pick closest match.",
  "companyType": "string — same as companytype (for company schema compatibility)",
  "aboutCompany": "string — company overview, 100-160 words. Include what the company does, industry, size/presence, and why it's a good place to work.",
  "companyInfo": "string — short 1-2 line company summary",
  "careerPageLink": "string or null — company careers page URL",
  "linkedinPageLink": "string or null — company LinkedIn page URL. Infer as https://www.linkedin.com/company/[company-name-slug]/ if not found.",
  "platform": "string — detect from apply URL domain: linkedin.com→'linkedin', naukri.com→'naukri', indeed.com→'indeed', otherwise 'careerspage'",
  "jobId": "string or null — job ID if mentioned in the posting",
  "tags": "array of strings — select ONLY from: ['software', 'frontend', 'backend', 'fullstack', 'web3', 'devops', 'testing', 'app', 'datascience', 'analytics', 'uiux', 'ai', 'ml', 'android', 'ios', 'blockchain', 'hacking', 'security', 'cloud']. Max 5. Pick most relevant.",
  "category": "string — one of: 'engineering', 'design', 'product', 'data', 'devops', 'qa', 'management', 'other'. Infer from title and skills."
}

FORMATTING RULES:
- eligibility, responsibility, benefits, skills MUST use HTML list format: <ul><li>Point 1</li><li>Point 2</li></ul>
- Maximum 5 <li> items per list. Combine shorter related points into one.
- Do NOT use arrays for list fields — use HTML string format.
- tags and skilltags are arrays of strings.
- All tag values must be lowercase.

SALARY ESTIMATION (when salary is NOT explicitly mentioned):
- MNCs (Google, Amazon, Microsoft, Apple): ₹10LPA – ₹20LPA
- Product companies (Flipkart, Paytm, PhonePe): ₹8LPA – ₹15LPA
- Mid-tier IT (TCS, Infosys, Wipro, HCL, Cognizant): ₹3LPA – ₹5LPA
- Startups: ₹4LPA – ₹8LPA
- Adjust by role: SDE/ML/Data → higher range, QA/Support → lower range
- Adjust by location: Bangalore/Hyderabad/Pune → higher, Tier-2 → 10-20% lower
- For internships estimate stipend: MNCs → ₹30000-60000/month, Mid-tier → ₹10000-25000/month, Startups → ₹15000-30000/month
- Always include (estimated) suffix when estimating: e.g. "₹4LPA – ₹6LPA (estimated)"

OTHER RULES:
- If a field cannot be determined, set to null (or [] for arrays) — except salary (always estimate)
- Infer batch years from experience: "freshers" or "0-1 years" → current year and previous 2 years
- The "link" field must be the company career page / direct apply URL, NOT the aggregator URL
- Do NOT add or assume information beyond what is provided, except for salary estimation, company overview, and LinkedIn URL
- Output must be strictly valid JSON`;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transform(rawJob) {
    const provider = getProvider();
    const maxAttempts = 3;

    const userMessage = JSON.stringify({
        sourceUrl: rawJob.sourceUrl,
        companyPageUrl: rawJob.companyPageUrl,
        meta: rawJob.meta,
        pageContent: rawJob.pageContent,
        companyPageContent: rawJob.companyPageContent,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(
                `[Transformer] Transforming job from ${rawJob.sourceUrl} (attempt ${attempt}, provider: ${provider.name})`
            );

            let response = await provider.complete(SYSTEM_PROMPT, userMessage);

            // Strip markdown code blocks if AI wraps in them
            response = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

            const parsed = JSON.parse(response);

            // Validate required fields
            if (!parsed.title) {
                throw new Error("Missing required field: title");
            }

            // Use company page URL as link if AI didn't extract one
            if (!parsed.link) {
                parsed.link = rawJob.companyPageUrl || rawJob.sourceUrl;
            }

            // Ensure arrays for tag fields
            if (!Array.isArray(parsed.tags)) parsed.tags = [];
            if (!Array.isArray(parsed.skilltags)) parsed.skilltags = [];

            // Enforce tag limits
            parsed.tags = parsed.tags.slice(0, 5).map((t) => t.toLowerCase());
            parsed.skilltags = parsed.skilltags.slice(0, 10).map((t) => t.toLowerCase());

            // Normalize enums
            const validWorkModes = ["onsite", "hybrid", "remote"];
            parsed.workMode = validWorkModes.includes(parsed.workMode?.toLowerCase())
                ? parsed.workMode.toLowerCase()
                : "onsite";

            const validCategories = ["engineering", "design", "product", "data", "devops", "qa", "management", "other"];
            parsed.category = validCategories.includes(parsed.category?.toLowerCase())
                ? parsed.category.toLowerCase()
                : "other";
            if (!parsed.platform) parsed.platform = "careerspage";
            if (!parsed.jobtype) parsed.jobtype = "Full time";
            if (!parsed.companytype) parsed.companytype = "Others";
            if (!parsed.companyType) parsed.companyType = parsed.companytype;

            console.log(`[Transformer] Successfully transformed: ${parsed.title}`);
            return parsed;
        } catch (err) {
            console.error(
                `[Transformer] Attempt ${attempt} failed: ${err.message}`
            );
            if (attempt < maxAttempts) {
                const backoff = Math.pow(2, attempt) * 1000;
                console.log(`[Transformer] Retrying in ${backoff}ms...`);
                await delay(backoff);
            } else {
                throw new Error(
                    `[Transformer] All ${maxAttempts} attempts failed for ${rawJob.sourceUrl}: ${err.message}`
                );
            }
        }
    }
}

async function transformBatch(rawJobs) {
    const results = [];
    const errors = [];

    for (const rawJob of rawJobs) {
        try {
            const transformed = await transform(rawJob);
            results.push({
                ...rawJob,
                jobData: transformed,
            });
        } catch (err) {
            console.error(`[Transformer] Skipping job: ${err.message}`);
            errors.push({
                jobUrl: rawJob.sourceUrl,
                step: "transform",
                message: err.message,
            });
        }
    }

    return { results, errors };
}

module.exports = { transform, transformBatch, SYSTEM_PROMPT };
