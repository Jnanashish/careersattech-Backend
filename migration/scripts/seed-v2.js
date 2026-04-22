const path = require("path");
const readline = require("readline");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");

require(path.join(__dirname, "..", "..", "DB", "connection"));

const JobV2 = require(path.join(__dirname, "..", "..", "model", "jobV2.schema"));
const CompanyV2 = require(path.join(__dirname, "..", "..", "model", "companyV2.schema"));
const { generateJobSlug, generateCompanySlug } = require(path.join(__dirname, "..", "..", "utils", "slugify"));

const RESET = process.argv.includes("--reset");

function prompt(message) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(message, (answer) => {
            rl.close();
            resolve((answer || "").trim());
        });
    });
}

function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

function randomFutureDate(minDays, maxDays) {
    const d = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
    return daysFromNow(d);
}

function seoFor(title, companyName) {
    return {
        metaTitle: `${title} at ${companyName} | CareersAt.Tech`,
        metaDescription: `Apply for ${title} at ${companyName}. View eligibility, salary range, skills required, and apply now on CareersAt.Tech.`,
    };
}

const COMPANIES = [
    {
        companyName: "Stripe",
        companyType: "product",
        industry: "Fintech",
        foundedYear: 2010,
        employeeCount: "5000+",
        website: "https://stripe.com",
        logo: { icon: "https://logo.clearbit.com/stripe.com" },
        headquarters: "San Francisco",
        locations: ["Bangalore", "Remote India"],
    },
    {
        companyName: "Google",
        companyType: "bigtech",
        industry: "SaaS",
        foundedYear: 1998,
        employeeCount: "5000+",
        website: "https://google.com",
        logo: { icon: "https://logo.clearbit.com/google.com" },
        headquarters: "Mountain View",
        locations: ["Bangalore", "Hyderabad", "Gurgaon"],
    },
    {
        companyName: "Accenture",
        companyType: "consulting",
        industry: "IT Services",
        foundedYear: 1989,
        employeeCount: "5000+",
        website: "https://accenture.com",
        logo: { icon: "https://logo.clearbit.com/accenture.com" },
        headquarters: "Dublin",
        locations: ["Bangalore", "Hyderabad", "Mumbai", "Pune"],
    },
];

function jobDescriptionHtml(title, companyName) {
    return `<h2>About the role</h2><p>${companyName} is hiring a ${title}. You'll work with a world-class team on high-impact products used by millions of users.</p><h3>Responsibilities</h3><ul><li>Design, build, and ship features end-to-end</li><li>Collaborate with product, design, and engineering</li><li>Write clean, well-tested code</li></ul><h3>Requirements</h3><ul><li>Strong fundamentals in CS</li><li>Experience with modern stacks</li><li>Good communication skills</li></ul>`;
}

function buildJobs(companiesByName) {
    const specs = [
        {
            title: "Software Engineer",
            company: "Stripe",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "onsite",
            category: "engineering",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 1800000, max: 2400000, unitText: "YEAR" },
            requiredSkills: ["JavaScript", "TypeScript", "React", "Node.js"],
            preferredSkills: ["Go", "PostgreSQL"],
            topicTags: ["fintech", "payments"],
        },
        {
            title: "Frontend Engineer Intern",
            company: "Stripe",
            employmentType: ["INTERN"],
            batch: [2026, 2027],
            workMode: "hybrid",
            category: "engineering",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 60000, max: 80000, unitText: "MONTH" },
            requiredSkills: ["HTML", "CSS", "JavaScript", "React"],
            topicTags: ["internship", "frontend"],
        },
        {
            title: "Data Analyst",
            company: "Stripe",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "remote",
            category: "data",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 1500000, max: 2000000, unitText: "YEAR" },
            requiredSkills: ["SQL", "Python", "Pandas", "Tableau"],
            topicTags: ["analytics", "data"],
        },
        {
            title: "Software Engineer II",
            company: "Google",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "onsite",
            category: "engineering",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 2000000, max: 2500000, unitText: "YEAR" },
            requiredSkills: ["Java", "C++", "Go", "Distributed Systems"],
            preferredSkills: ["Kubernetes", "gRPC"],
            topicTags: ["bigtech", "backend"],
        },
        {
            title: "Associate Product Manager Intern",
            company: "Google",
            employmentType: ["INTERN"],
            batch: [2026, 2027],
            workMode: "hybrid",
            category: "product",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 100000, max: 120000, unitText: "MONTH" },
            requiredSkills: ["Product Strategy", "SQL", "Analytics"],
            topicTags: ["apm", "internship"],
        },
        {
            title: "UX Designer",
            company: "Google",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "onsite",
            category: "design",
            status: "published",
            displayMode: "external_redirect",
            baseSalary: { min: 1800000, max: 2200000, unitText: "YEAR" },
            requiredSkills: ["Figma", "User Research", "Prototyping"],
            topicTags: ["design", "ux"],
            externalApplyLink: "https://careers.google.com/jobs/ux-designer",
        },
        {
            title: "Machine Learning Engineer",
            company: "Google",
            employmentType: ["FULL_TIME"],
            batch: [2027],
            workMode: "remote",
            category: "engineering",
            status: "draft",
            displayMode: "internal",
            baseSalary: { min: 2200000, max: 2500000, unitText: "YEAR" },
            requiredSkills: ["Python", "PyTorch", "TensorFlow", "ML"],
            topicTags: ["ml", "ai"],
        },
        {
            title: "Associate Software Engineer",
            company: "Accenture",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "onsite",
            category: "engineering",
            status: "published",
            displayMode: "internal",
            baseSalary: { min: 600000, max: 900000, unitText: "YEAR" },
            requiredSkills: ["Java", "Spring Boot", "SQL"],
            topicTags: ["consulting", "enterprise"],
        },
        {
            title: "Data Engineer",
            company: "Accenture",
            employmentType: ["FULL_TIME"],
            batch: [2025, 2026],
            workMode: "hybrid",
            category: "data",
            status: "published",
            displayMode: "external_redirect",
            baseSalary: { min: 800000, max: 1200000, unitText: "YEAR" },
            requiredSkills: ["Python", "Spark", "Airflow", "SQL"],
            topicTags: ["data-engineering"],
            externalApplyLink: "https://www.accenture.com/in-en/careers/jobdetails?id=data-eng",
        },
        {
            title: "Analyst Intern",
            company: "Accenture",
            employmentType: ["INTERN"],
            batch: [2027],
            workMode: "onsite",
            category: "engineering",
            status: "expired",
            displayMode: "internal",
            baseSalary: { min: 25000, max: 35000, unitText: "MONTH" },
            requiredSkills: ["Excel", "SQL", "Python"],
            topicTags: ["internship"],
        },
    ];

    return specs.map((s) => {
        const companyDoc = companiesByName[s.company];
        const slug = generateJobSlug(s.company, s.title);
        const doc = {
            title: s.title,
            slug,
            company: companyDoc._id,
            companyName: s.company,
            displayMode: s.displayMode,
            applyLink:
                s.externalApplyLink ||
                `https://careersat.tech/jobs/${slug}`,
            employmentType: s.employmentType,
            batch: s.batch,
            category: s.category,
            workMode: s.workMode,
            jobLocation: companyDoc.locations.slice(0, 2).map((city) => ({ city, country: "IN" })),
            baseSalary: { currency: "INR", ...s.baseSalary },
            requiredSkills: s.requiredSkills || [],
            preferredSkills: s.preferredSkills || [],
            topicTags: s.topicTags || [],
            applyPlatform: s.displayMode === "external_redirect" ? "careerspage" : "careerspage",
            status: s.status,
            isVerified: true,
            seo: seoFor(s.title, s.company),
            source: "manual",
        };

        if (s.displayMode === "internal") {
            doc.jobDescription = { html: jobDescriptionHtml(s.title, s.company) };
        }

        if (s.status === "published") {
            doc.validThrough = randomFutureDate(7, 60);
        } else if (s.status === "expired") {
            doc.validThrough = daysFromNow(-3);
        }

        return doc;
    });
}

async function main() {
    console.log("=== seed-v2 ===");
    console.log("DB:", (process.env.DATABASE || "").replace(/\/\/[^@]+@/, "//***@"));

    if (!mongoose.connection.readyState || mongoose.connection.readyState !== 1) {
        await mongoose.connection.asPromise();
    }
    console.log("Connected.");

    if (RESET) {
        console.log("\n--reset flag detected.");
        console.log("About to DELETE all documents from: jobs_v2, companies_v2");
        console.log("Legacy collections (jobdescs, companylogos) will NOT be touched.");
        const answer = await prompt("Type 'yes' to confirm: ");
        if (answer !== "yes") {
            console.log("Aborted (no changes made).");
            await mongoose.disconnect();
            process.exit(0);
        }
        const jobDelete = await JobV2.deleteMany({});
        const companyDelete = await CompanyV2.deleteMany({});
        console.log(`Deleted ${jobDelete.deletedCount} jobs_v2 docs`);
        console.log(`Deleted ${companyDelete.deletedCount} companies_v2 docs`);
    }

    console.log("\n--- Seeding companies ---");
    const companyDocs = {};
    for (const spec of COMPANIES) {
        const slug = generateCompanySlug(spec.companyName);
        const doc = await CompanyV2.create({
            ...spec,
            slug,
            status: "active",
            isVerified: true,
            seo: {
                metaTitle: `${spec.companyName} Careers | Jobs for Freshers`,
                metaDescription: `Explore open roles at ${spec.companyName}. Apply to ${spec.companyName} jobs for freshers on CareersAt.Tech.`,
            },
        });
        companyDocs[spec.companyName] = doc;
        console.log(`  [company] _id=${doc._id}  slug=${doc.slug}  name=${doc.companyName}`);
    }

    console.log("\n--- Seeding jobs ---");
    const jobSpecs = buildJobs(companyDocs);
    const createdJobs = [];
    for (const j of jobSpecs) {
        const doc = await JobV2.create(j);
        createdJobs.push(doc);
        console.log(
            `  [job] _id=${doc._id}  slug=${doc.slug}  status=${doc.status}  displayMode=${doc.displayMode}  company=${doc.companyName}`
        );
    }

    console.log("\n--- Updating company stats ---");
    for (const [name, companyDoc] of Object.entries(companyDocs)) {
        const openCount = await JobV2.countDocuments({ company: companyDoc._id, status: "published" });
        const total = await JobV2.countDocuments({ company: companyDoc._id });
        await CompanyV2.updateOne(
            { _id: companyDoc._id },
            { $set: { "stats.openJobsCount": openCount, "stats.totalJobsEverPosted": total } }
        );
        console.log(`  [stats] ${name}  openJobsCount=${openCount}  totalJobsEverPosted=${total}`);
    }

    const finalCompanyCount = await CompanyV2.countDocuments();
    const finalJobCount = await JobV2.countDocuments();
    console.log("\n=== Final counts ===");
    console.log(`  companies_v2: ${finalCompanyCount}`);
    console.log(`  jobs_v2:      ${finalJobCount}`);

    await mongoose.disconnect();
    console.log("Done.");
    process.exit(0);
}

main().catch(async (err) => {
    console.error("FATAL:", err);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
