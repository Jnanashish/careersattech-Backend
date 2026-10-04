// Ported from admin-panel/src/Helpers/JobListHelper/hashtagBank.js — ESM → CommonJS,
// content otherwise verbatim. The admin Daily Digest builds the same caption
// in the browser, so a change to one copy must be made to the other.

// =========================================================
// @careersattech — Master Hashtag Bank (Nov 2026)
// Single source of truth · All content types covered
// =========================================================
//
// USAGE: Pull 8-10 tags per post using this formula:
//   3-4 from BASE  +  2-3 from TECH/CONTEXT  +  1-2 LOCATION  +  (1 COMPANY)
// =========================================================

const hashtagBank = {
    base: [
        "#offcampusdrive",
        "#placementdrive",
        "#campusplacement",
        "#freshershiring",
        "#freshersjobs",
        "#fresherjobsindia",
        "#jobsforfreshers",
        "#placementseason",
        "#campusdrive",
        "#placedstudents",
        "#hiringalert",
        "#jobupdates",
    ],

    audience: [
        "#engineeringstudents",
        "#btechstudents",
        "#engineeringlife",
        "#engineeringcollege",
        "#computerscienceengineering",
        "#cseengineering",
        "#mcastudents",
        "#collegestudentsindia",
        "#studentlifeindia",
        "#engineeringfreshers",
    ],

    batch: [
        "#2024batch",
        "#2025batch",
        "#2026batch",
        "#2027batch",
        "#2024passout",
        "#2025passout",
        "#2026passout",
    ],

    techStack: {
        frontend: [
            "#reactjs",
            "#frontenddeveloper",
            "#javascriptdeveloper",
            "#webdeveloper",
            "#frontendjobs",
            "#nextjs",
            "#typescript",
        ],
        backend: [
            "#backenddeveloper",
            "#nodejs",
            "#javadeveloper",
            "#pythondeveloper",
            "#backendjobs",
            "#springboot",
            "#golang",
        ],
        fullstack: [
            "#fullstackdeveloper",
            "#mernstack",
            "#meanstack",
            "#fullstackjobs",
            "#webdevelopment",
        ],
        data: [
            "#datascience",
            "#dataanalyst",
            "#dataengineer",
            "#datasciencejobs",
            "#dataanalytics",
            "#sqljobs",
            "#powerbi",
        ],
        aiml: [
            "#machinelearning",
            "#artificialintelligence",
            "#aijobs",
            "#mljobs",
            "#deeplearning",
            "#mlengineer",
            "#genai",
        ],
        devops: [
            "#devops",
            "#cloudengineer",
            "#awsjobs",
            "#sre",
            "#devopsengineer",
            "#kubernetes",
            "#docker",
        ],
        mobile: [
            "#androiddeveloper",
            "#iosdeveloper",
            "#flutterdeveloper",
            "#reactnative",
            "#mobiledev",
            "#mobiledeveloper",
        ],
        qa: [
            "#softwaretesting",
            "#qajobs",
            "#automationtesting",
            "#sdet",
            "#seleniumtesting",
            "#manualtesting",
        ],
        security: [
            "#cybersecurity",
            "#cybersecurityjobs",
            "#infosec",
            "#ethicalhacking",
            "#securityengineer",
        ],
        generic: [
            "#softwareengineer",
            "#softwaredeveloper",
            "#developerjobs",
            "#codingjobs",
            "#techjobs",
            "#techcareers",
            "#techjobsindia",
            "#itjobs",
            "#softwarejobs",
        ],
    },

    location: {
        bangalore: ["#bangalorejobs", "#bengalurujobs", "#jobsinbangalore"],
        hyderabad: ["#hyderabadjobs", "#jobsinhyderabad"],
        pune: ["#punejobs", "#jobsinpune"],
        chennai: ["#chennaijobs", "#jobsinchennai"],
        delhi: ["#delhijobs", "#delhincrjobs"],
        gurgaon: ["#gurgaonjobs", "#gurugramjobs"],
        noida: ["#noidajobs"],
        mumbai: ["#mumbaijobs", "#jobsinmumbai"],
        kolkata: ["#kolkatajobs"],
        ahmedabad: ["#ahmedabadjobs"],
        remote: ["#remotejobsindia", "#workfromhomejobs", "#wfhjobs"],
    },

    company: {
        google: ["#googlejobs", "#googleindia"],
        microsoft: ["#microsoftjobs", "#microsoftindia"],
        amazon: ["#amazonjobs", "#amazonhiring"],
        meta: ["#metajobs", "#facebookjobs"],
        apple: ["#applejobs"],
        netflix: ["#netflixjobs"],
        adobe: ["#adobejobs", "#adobeindia"],
        salesforce: ["#salesforcejobs", "#salesforcehiring"],
        oracle: ["#oraclejobs", "#oraclehiring"],
        uber: ["#uberjobs"],
        nvidia: ["#nvidiajobs"],
        intel: ["#inteljobs"],

        blackrock: ["#blackrockcareers"],
        visa: ["#visajobs"],
        mastercard: ["#mastercardjobs"],
        jpmorgan: ["#jpmorganchase", "#jpmorganjobs"],
        goldmansachs: ["#goldmansachs"],
        morganstanley: ["#morganstanley"],

        tcs: ["#tcs", "#tcsjobs", "#tcshiring"],
        infosys: ["#infosys", "#infosysjobs"],
        wipro: ["#wipro", "#wiprojobs"],
        accenture: ["#accenture", "#accenturehiring"],
        capgemini: ["#capgemini"],
        cognizant: ["#cognizant", "#cognizantjobs"],
        ibm: ["#ibmjobs", "#ibmhiring"],
        deloitte: ["#deloitte"],
        hcl: ["#hcljobs", "#hcltech"],
        techmahindra: ["#techmahindra"],

        flipkart: ["#flipkartjobs"],
        swiggy: ["#swiggyjobs"],
        zomato: ["#zomatojobs"],
        paytm: ["#paytmjobs"],
        phonepe: ["#phonepejobs"],
        razorpay: ["#razorpayjobs"],
        ola: ["#olajobs"],
        cred: ["#credjobs"],
        zerodha: ["#zerodhajobs"],
    },

    contentType: {
        interviewPrep: [
            "#codinginterview",
            "#interviewprep",
            "#interviewtips",
            "#placementpreparation",
            "#leetcode",
            "#systemdesign",
            "#dsa",
            "#datastructuresandalgorithms",
            "#hrinterview",
        ],
        resume: [
            "#resumetips",
            "#resumebuilder",
            "#resumewriting",
            "#cvtips",
            "#atsresume",
            "#fresherresume",
        ],
        referral: [
            "#linkedintips",
            "#networking",
            "#linkedinforjobs",
            "#jobreferral",
            "#coldoutreach",
        ],
        careerAdvice: [
            "#careerguidance",
            "#careergrowth",
            "#careersintech",
            "#techcareers",
            "#careerdevelopment",
            "#careertips",
            "#careeradvice",
        ],
        internship: [
            "#internshipsindia",
            "#freshersinternship",
            "#techinternship",
            "#internshipopportunity",
            "#internindia",
            "#summerinternship",
            "#paidinternship",
        ],
    },

    special: {
        walkIn: [
            "#walkininterview",
            "#walkindrive",
            "#walkin",
            "#walkininterviews",
        ],
        deadlineUrgent: [
            "#hiringnow",
            "#applynow",
            "#urgenthiring",
            "#immediatehiring",
            "#applybeforedeadline",
        ],
        diversity: [
            "#womenintech",
            "#womenhiring",
            "#diversityandinclusion",
            "#womenintechindia",
            "#stemwomen",
        ],
        salary: [
            "#highpayingjobs",
            "#highpayingitjobs",
            "#salaryguide",
            "#ctcdisclosed",
        ],
        bulkDrive: [
            "#massiverecruitment",
            "#multiplecompanieshiring",
            "#weeklyjobupdates",
            "#bulkhiring",
        ],
    },

    reels: [
        "#reels",
        "#reelsindia",
        "#reelsinstagram",
        "#viralreels",
        "#trendingreels",
        "#instagramreels",
        "#reelitfeelit",
    ],
};

const avoidList = {
    buried_mega_tags: {
        tags: ["#hiring", "#jobs", "#jobsearch", "#recruitment", "#career"],
        reason: "Millions of posts each. Your content gets buried in seconds.",
    },
    wrong_audience: {
        tags: [
            "#freshers",
            "#offcampus",
            "#freshersweek",
            "#freshersparty",
            "#freshersnight",
        ],
        reason:
            "These overlap heavily with UK university Freshers' Week party content and US student-housing content.",
    },
    low_or_zero_volume: {
        tags: ["#jobseek"],
        reason: "Typo / unused. People search #jobseekers (with 's').",
    },
    spammy_or_banned: {
        tags: [
            "#follow4follow",
            "#like4like",
            "#followforfollow",
            "#explorepage",
            "#explore",
        ],
        reason:
            "Instagram penalizes these as spam signals. They actively reduce reach.",
    },
};

const comboPacks = {
    frontendDrop:
        "#reactjs #frontenddeveloper #javascriptdeveloper #offcampusdrive #placementdrive #freshershiring #2026batch #engineeringstudents #placementseason #bangalorejobs",
    backendDrop:
        "#backenddeveloper #javadeveloper #pythondeveloper #offcampusdrive #placementdrive #freshershiring #2026batch #engineeringstudents #placementseason #softwareengineer",
    fullstackDrop:
        "#fullstackdeveloper #mernstack #webdevelopment #offcampusdrive #placementdrive #freshershiring #2026batch #engineeringstudents #placementseason #techjobsindia",
    dataDrop:
        "#datascience #dataanalyst #dataengineer #offcampusdrive #placementdrive #freshershiring #2026batch #engineeringstudents #placementseason #techjobsindia",
    aimlDrop:
        "#machinelearning #artificialintelligence #mlengineer #offcampusdrive #placementdrive #freshershiring #2026batch #engineeringstudents #placementseason #aijobs",
    mixedDrop:
        "#offcampusdrive #placementdrive #campusplacement #freshershiring #freshersjobs #2026batch #engineeringstudents #placementseason #techjobsindia #fresherjobsindia",
    internshipDrop:
        "#internshipsindia #freshersinternship #techinternship #offcampusdrive #placementdrive #2026batch #engineeringstudents #campusplacement #placementseason #internshipopportunity",
    interviewPrep:
        "#codinginterview #interviewprep #leetcode #placementpreparation #engineeringstudents #btechstudents #campusplacement #careersintech #freshershiring #placementseason",
    resumeGuide:
        "#resumetips #resumebuilder #atsresume #careeradvice #engineeringstudents #freshersjobs #placementpreparation #careersintech #careerguidance #placementdrive",
    walkInDrive:
        "#walkininterview #walkindrive #hiringnow #immediatehiring #freshershiring #offcampusdrive #2026batch #engineeringstudents #fresherjobsindia #applynow",
};

module.exports = {
    hashtagBank,
    avoidList,
    comboPacks,
};
