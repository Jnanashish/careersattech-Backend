const escapeRegex = require("./escapeRegex");
const logger = require("./logger");

function apiErrorHandler(err, res) {
    logger.error(`API Error: ${err && err.stack ? err.stack : err}`);
    return res.status(500).json({ error: "Internal server error" });
}

async function countTotalEntries(filter = {}, filteredData) {
    const Jobdesc = require("../modules/jobs/jobs.model");
    const countFilter = { ...filter };
    if (filteredData) {
        countFilter.isActive = true;
        const expiry = {
            $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gte: new Date() } }],
        };
        if (countFilter.$or) {
            countFilter.$and = [{ $or: countFilter.$or }, expiry];
            delete countFilter.$or;
        } else {
            Object.assign(countFilter, expiry);
        }
    }
    return Jobdesc.countDocuments(countFilter);
}

function filterData(result) {
    return result
        .filter((value) => {
            if (value.isActive !== true) return false;
            if (value.expiresAt && value.expiresAt < new Date()) return false;
            return true;
        })
        .map((value) => {
            const {
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
                _id,
                isVerified,
                stipend,
                category,
                expiresAt,
            } = value;
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
                expiresAt,
            };
        });
}

async function jobDetailsHandler(result, res, conditions, filteredData = 0) {
    const data = {
        totalCount: await countTotalEntries(conditions, filteredData),
        data: filteredData ? filterData(result) : result,
    };
    return res.status(200).send(data);
}

module.exports = {
    apiErrorHandler,
    countTotalEntries,
    filterData,
    jobDetailsHandler,
    escapeRegex,
};
