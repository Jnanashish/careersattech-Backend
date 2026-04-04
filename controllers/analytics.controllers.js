const Jobdesc = require("../model/jobs.schema");
const JobClickEvent = require("../model/jobClickEvent.schema");
const { apiErrorHandler } = require("../Helpers/controllerHelper");

const getPeriodStart = (period) => {
    const now = new Date();
    switch (period) {
        case "7d":
            return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        case "30d":
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        case "90d":
            return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        case "all":
            return null;
        default:
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
};

const useWeekly = (period) => period === "90d" || period === "all";

// Fill missing dates/weeks with zeros between start and end
const fillTimeSeries = (dataMap, startDate, endDate, weekly) => {
    const result = [];
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);

    if (weekly) {
        // Align to Monday
        const day = current.getUTCDay();
        current.setUTCDate(current.getUTCDate() - ((day + 6) % 7));
    }

    while (current <= endDate) {
        const key = current.toISOString().split("T")[0];
        result.push({ date: key, ...(dataMap[key] || {}) });

        if (weekly) {
            current.setUTCDate(current.getUTCDate() + 7);
        } else {
            current.setUTCDate(current.getUTCDate() + 1);
        }
    }
    return result;
};

// GET /analytics/summary
exports.getSummary = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const periodStart = getPeriodStart(period);

        const [totalJobs, activeJobs, totalClicksAgg, jobsAddedInPeriod, clicksInPeriod, jobsExpiredInPeriod] =
            await Promise.all([
                Jobdesc.countDocuments(),
                Jobdesc.countDocuments({
                    isActive: true,
                    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gte: new Date() } }],
                }),
                Jobdesc.aggregate([{ $group: { _id: null, total: { $sum: "$totalclick" } } }]),
                periodStart
                    ? Jobdesc.countDocuments({ createdAt: { $gte: periodStart } })
                    : Jobdesc.countDocuments(),
                periodStart
                    ? JobClickEvent.countDocuments({ timestamp: { $gte: periodStart } })
                    : JobClickEvent.countDocuments(),
                periodStart
                    ? Jobdesc.countDocuments({
                          $or: [
                              { isActive: false, updatedAt: { $gte: periodStart } },
                              { lastdate: { $exists: true, $ne: "" }, lastdate: { $lte: new Date().toISOString().split("T")[0] }, updatedAt: { $gte: periodStart } },
                              { expiresAt: { $lte: new Date(), $gte: periodStart } },
                          ],
                      })
                    : Jobdesc.countDocuments({ isActive: false }),
            ]);

        const totalClicks = totalClicksAgg.length > 0 ? totalClicksAgg[0].total : 0;

        return res.status(200).json({
            success: true,
            data: {
                totalJobs,
                activeJobs,
                expiredJobs: totalJobs - activeJobs,
                totalClicks,
                jobsAddedInPeriod,
                jobsExpiredInPeriod,
                clicksInPeriod,
            },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// GET /analytics/jobs-over-time
exports.getJobsOverTime = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const periodStart = getPeriodStart(period);
        const weekly = useWeekly(period);
        const now = new Date();

        const dateGroupExpr = weekly
            ? {
                  $dateToString: {
                      format: "%Y-%m-%d",
                      date: { $dateTrunc: { date: "$createdAt", unit: "week", startOfWeek: "monday" } },
                  },
              }
            : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };

        const expiryDateGroupExpr = weekly
            ? {
                  $dateToString: {
                      format: "%Y-%m-%d",
                      date: { $dateTrunc: { date: "$expiresAt", unit: "week", startOfWeek: "monday" } },
                  },
              }
            : { $dateToString: { format: "%Y-%m-%d", date: "$expiresAt" } };

        const matchStage = periodStart ? { $match: { createdAt: { $gte: periodStart } } } : { $match: {} };
        const expiryMatchStage = periodStart
            ? { $match: { expiresAt: { $exists: true, $lte: now, $gte: periodStart } } }
            : { $match: { expiresAt: { $exists: true, $lte: now } } };

        const [addedAgg, expiredAgg] = await Promise.all([
            Jobdesc.aggregate([
                matchStage,
                { $group: { _id: dateGroupExpr, jobsAdded: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            Jobdesc.aggregate([
                expiryMatchStage,
                { $group: { _id: expiryDateGroupExpr, jobsExpired: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
        ]);

        // Merge into a single map
        const dataMap = {};
        for (const entry of addedAgg) {
            dataMap[entry._id] = { jobsAdded: entry.jobsAdded, jobsExpired: 0 };
        }
        for (const entry of expiredAgg) {
            if (!dataMap[entry._id]) dataMap[entry._id] = { jobsAdded: 0, jobsExpired: 0 };
            dataMap[entry._id].jobsExpired = entry.jobsExpired;
        }

        const startDate = periodStart || new Date("2020-01-01");
        const data = fillTimeSeries(dataMap, startDate, now, weekly);
        // Set defaults for missing fields
        for (const entry of data) {
            entry.jobsAdded = entry.jobsAdded || 0;
            entry.jobsExpired = entry.jobsExpired || 0;
        }

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// GET /analytics/clicks-over-time
exports.getClicksOverTime = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const periodStart = getPeriodStart(period);
        const weekly = useWeekly(period);
        const now = new Date();

        const dateGroupExpr = weekly
            ? {
                  $dateToString: {
                      format: "%Y-%m-%d",
                      date: { $dateTrunc: { date: "$timestamp", unit: "week", startOfWeek: "monday" } },
                  },
              }
            : { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } };

        const matchStage = periodStart ? { $match: { timestamp: { $gte: periodStart } } } : { $match: {} };

        const clicksAgg = await JobClickEvent.aggregate([
            matchStage,
            { $group: { _id: dateGroupExpr, clicks: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);

        const dataMap = {};
        for (const entry of clicksAgg) {
            dataMap[entry._id] = { clicks: entry.clicks };
        }

        const startDate = periodStart || new Date("2020-01-01");
        const data = fillTimeSeries(dataMap, startDate, now, weekly);
        for (const entry of data) {
            entry.clicks = entry.clicks || 0;
        }

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// GET /analytics/top-jobs
exports.getTopJobs = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
        const periodStart = getPeriodStart(period);

        let data;

        if (!periodStart) {
            // "all" — use totalclick on job document directly (faster)
            data = await Jobdesc.find()
                .sort({ totalclick: -1 })
                .limit(limit)
                .select("title companyName imagePath location isActive createdAt totalclick")
                .lean();

            data = data.map((job) => ({
                jobId: job._id,
                title: job.title,
                companyName: job.companyName,
                companyLogo: job.imagePath,
                location: job.location,
                clicks: job.totalclick || 0,
                isActive: job.isActive,
                createdAt: job.createdAt,
            }));
        } else {
            // Aggregate clicks from click events within period
            const topClicks = await JobClickEvent.aggregate([
                { $match: { timestamp: { $gte: periodStart } } },
                { $group: { _id: "$jobId", clicks: { $sum: 1 } } },
                { $sort: { clicks: -1 } },
                { $limit: limit },
            ]);

            const jobIds = topClicks.map((c) => c._id);
            const jobs = await Jobdesc.find({ _id: { $in: jobIds } })
                .select("title companyName imagePath location isActive createdAt")
                .lean();

            const jobMap = {};
            for (const job of jobs) {
                jobMap[job._id.toString()] = job;
            }

            data = topClicks.map((click) => {
                const job = jobMap[click._id.toString()] || {};
                return {
                    jobId: click._id,
                    title: job.title,
                    companyName: job.companyName,
                    companyLogo: job.imagePath,
                    location: job.location,
                    clicks: click.clicks,
                    isActive: job.isActive,
                    createdAt: job.createdAt,
                };
            });
        }

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// GET /analytics/jobs-by-category
exports.getJobsByCategory = async (req, res) => {
    try {
        const groupBy = req.query.groupBy;
        const allowedFields = ["jobtype", "workMode", "location", "companytype", "tags"];

        if (!groupBy || !allowedFields.includes(groupBy)) {
            return res.status(400).json({
                error: `groupBy is required and must be one of: ${allowedFields.join(", ")}`,
            });
        }

        const pipeline = [{ $match: { isActive: true } }];

        // Unwind array fields before grouping
        if (groupBy === "tags") {
            pipeline.push({ $unwind: "$tags" });
        }

        pipeline.push(
            { $group: { _id: `$${groupBy}`, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, label: { $ifNull: ["$_id", "Unknown"] }, count: 1 } }
        );

        const data = await Jobdesc.aggregate(pipeline);

        return res.status(200).json({ success: true, groupBy, data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
