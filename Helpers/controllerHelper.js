const Jobdesc = require("../model/jobs.schema");

// handle api error
exports.apiErrorHandler = (err, res) => {
    return res.status(500).json({
        error: err?.message,
    });
};

const totalEntriesCount = async (req, res) => {
    const calculateCount = (err, count) => {
        return count;
    }

    return Jobdesc.count({}, calculateCount())
};


exports.jobDetailsHandler = async (result, res) => {
    var data = {
        totalCount : await totalEntriesCount(),
        data: result.filter(value => value.isActive === true).map((value) => {
            const { id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt, location, experience, totalclick, companytype, role, companyName, companyInfo, companyType, company } = value;
            return {
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
                company
            };
        }),
    };
    return res.status(200).send(data);
};
