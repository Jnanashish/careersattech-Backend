const Jobdesc = require("../model/jobs.schema");

// escape special regex characters from user input to prevent ReDoS attacks
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
exports.escapeRegex = escapeRegex;

// handle api error
exports.apiErrorHandler = (err, res) => {
    console.error("API Error:", err);
    return res.status(500).json({
        error: "Internal server error",
    });
};

// count total number of entries based on filter
const countTotalEntries = async (filter = {}, filteredData) => {
    // if response array is filtered, filter the count also
    if(!!filteredData){
        filter.isActive = true;
        filter.$or = [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gte: new Date() } }
        ];
    }
    const count = await Jobdesc.countDocuments(filter);
    return count;
};

const filterData = (result) => {
    const filteredArray = result
        .filter((value) => {
            if (value.isActive !== true) return false;
            if (value.expiresAt && value.expiresAt < new Date()) return false;
            return true;
        })
        .map((value) => {
            const { id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt, location, experience, totalclick, companytype, role, companyName, companyInfo, companyType, company, isActive, _id, isVerified, stipend, category, expiresAt } =
                value;
            return {
                _id,
                id,
                title,
                link,
                batch,
                degree,
                jobtype,
                imagePath,
                jdpage,
                createdAt,
                location,
                experience,
                totalclick,
                companytype,
                role,
                companyName,
                companyInfo,
                companyType,
                company,
                isActive,
                isVerified,
                stipend,
                category,
                expiresAt
            };
        });

        return filteredArray;
};

// return job details
exports.jobDetailsHandler = async (result, res, conditions, filteredData = 0) => {
    var data = {
        totalCount: await countTotalEntries(conditions, filteredData),
        data: !!filteredData ? filterData(result) : result,
    };

    return res.status(200).send(data);
};
