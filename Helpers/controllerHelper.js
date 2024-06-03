const { log } = require("console");
const Jobdesc = require("../model/jobs.schema");

// handle api error
exports.apiErrorHandler = (err, res) => {
    return res.status(500).json({
        error: err?.message,
    });
};

const countTotalEntries = async (filter = {}) => {
    const count = await Jobdesc.countDocuments(filter);
    return count;
};

const totalEntriesCount = async (req, res) => {
    const calculateCount = (err, count) => {
        return count;
    };

    return Jobdesc.count({}, calculateCount());
};

const filterData = (result) => {
    const filteredArray = result
        .filter((value) => value.isActive === true)
        .map((value) => {
            const { id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt, location, experience, totalclick, companytype, role, companyName, companyInfo, companyType, company } =
                value;
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
                company,
            };
        });

        return filteredArray;
};

exports.jobDetailsHandler = async (result, res, conditions, filteredData = false) => {
    // console.log("filterData(result)", filterData(result), result);
    var data = {
        totalCount: await countTotalEntries(conditions),
        data: filteredData ? filterData(result) : result,
    };

    return res.status(200).send(data);
};
