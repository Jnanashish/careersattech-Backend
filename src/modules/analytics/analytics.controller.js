const Jobdesc = require("../jobs/jobs.model");
const JobClickEvent = require("../jobsV2/jobClickEvent.model");
const JobV2 = require("../jobsV2/jobsV2.model");
const JobClickV2 = require("../jobsV2/jobClickV2.model");
const { apiErrorHandler } = require("../../utils/controllerHelper");

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
        const now = new Date();

        const legacyActiveFilter = {
            isActive: true,
            $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gte: now } }],
        };
        const v2BaseFilter = { deletedAt: null };
        const v2ActiveFilter = {
            ...v2BaseFilter,
            status: "published",
            $or: [{ validThrough: { $exists: false } }, { validThrough: null }, { validThrough: { $gte: now } }],
        };

        const [
            legacyTotal,
            legacyActive,
            legacyTotalClicksAgg,
            legacyJobsAddedInPeriod,
            legacyClicksInPeriod,
            legacyJobsExpiredInPeriod,
            v2Total,
            v2Active,
            v2TotalClicksAgg,
            v2JobsAddedInPeriod,
            v2ClicksInPeriod,
            v2JobsExpiredInPeriod,
        ] = await Promise.all([
            Jobdesc.countDocuments(),
            Jobdesc.countDocuments(legacyActiveFilter),
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
                          { expiresAt: { $lte: now, $gte: periodStart } },
                      ],
                  })
                : Jobdesc.countDocuments({ isActive: false }),
            JobV2.countDocuments(v2BaseFilter),
            JobV2.countDocuments(v2ActiveFilter),
            JobV2.aggregate([
                { $match: v2BaseFilter },
                { $group: { _id: null, total: { $sum: "$stats.applyClicks" } } },
            ]),
            periodStart
                ? JobV2.countDocuments({ ...v2BaseFilter, createdAt: { $gte: periodStart } })
                : JobV2.countDocuments(v2BaseFilter),
            periodStart
                ? JobClickV2.countDocuments({ eventType: "apply_click", timestamp: { $gte: periodStart } })
                : JobClickV2.countDocuments({ eventType: "apply_click" }),
            periodStart
                ? JobV2.countDocuments({
                      ...v2BaseFilter,
                      $or: [
                          { status: "expired", updatedAt: { $gte: periodStart } },
                          { validThrough: { $lte: now, $gte: periodStart } },
                      ],
                  })
                : JobV2.countDocuments({ ...v2BaseFilter, status: "expired" }),
        ]);

        const legacyTotalClicks = legacyTotalClicksAgg.length > 0 ? legacyTotalClicksAgg[0].total : 0;
        const v2TotalClicks = v2TotalClicksAgg.length > 0 ? v2TotalClicksAgg[0].total : 0;

        const totalJobs = legacyTotal + v2Total;
        const activeJobs = legacyActive + v2Active;

        return res.status(200).json({
            success: true,
            data: {
                totalJobs,
                activeJobs,
                expiredJobs: totalJobs - activeJobs,
                totalClicks: legacyTotalClicks + v2TotalClicks,
                jobsAddedInPeriod: legacyJobsAddedInPeriod + v2JobsAddedInPeriod,
                jobsExpiredInPeriod: legacyJobsExpiredInPeriod + v2JobsExpiredInPeriod,
                clicksInPeriod: legacyClicksInPeriod + v2ClicksInPeriod,
            },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// Build $dateToString expression for grouping by day or week
const buildDateGroupExpr = (field, weekly) =>
    weekly
        ? {
              $dateToString: {
                  format: "%Y-%m-%d",
                  date: { $dateTrunc: { date: `$${field}`, unit: "week", startOfWeek: "monday" } },
              },
          }
        : { $dateToString: { format: "%Y-%m-%d", date: `$${field}` } };

// GET /analytics/jobs-over-time
exports.getJobsOverTime = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const periodStart = getPeriodStart(period);
        const weekly = useWeekly(period);
        const now = new Date();

        const legacyAddedDateExpr = buildDateGroupExpr("createdAt", weekly);
        const legacyExpiredDateExpr = buildDateGroupExpr("expiresAt", weekly);
        const v2AddedDateExpr = buildDateGroupExpr("createdAt", weekly);
        const v2ExpiredDateExpr = buildDateGroupExpr("validThrough", weekly);

        const legacyAddedMatch = periodStart ? { createdAt: { $gte: periodStart } } : {};
        const legacyExpiredMatch = periodStart
            ? { expiresAt: { $exists: true, $lte: now, $gte: periodStart } }
            : { expiresAt: { $exists: true, $lte: now } };

        const v2AddedMatch = periodStart
            ? { deletedAt: null, createdAt: { $gte: periodStart } }
            : { deletedAt: null };
        const v2ExpiredMatch = periodStart
            ? { deletedAt: null, validThrough: { $exists: true, $ne: null, $lte: now, $gte: periodStart } }
            : { deletedAt: null, validThrough: { $exists: true, $ne: null, $lte: now } };

        const [legacyAddedAgg, legacyExpiredAgg, v2AddedAgg, v2ExpiredAgg] = await Promise.all([
            Jobdesc.aggregate([
                { $match: legacyAddedMatch },
                { $group: { _id: legacyAddedDateExpr, jobsAdded: { $sum: 1 } } },
            ]),
            Jobdesc.aggregate([
                { $match: legacyExpiredMatch },
                { $group: { _id: legacyExpiredDateExpr, jobsExpired: { $sum: 1 } } },
            ]),
            JobV2.aggregate([
                { $match: v2AddedMatch },
                { $group: { _id: v2AddedDateExpr, jobsAdded: { $sum: 1 } } },
            ]),
            JobV2.aggregate([
                { $match: v2ExpiredMatch },
                { $group: { _id: v2ExpiredDateExpr, jobsExpired: { $sum: 1 } } },
            ]),
        ]);

        const dataMap = {};
        const addToMap = (entries, field) => {
            for (const entry of entries) {
                if (!entry._id) continue;
                if (!dataMap[entry._id]) dataMap[entry._id] = { jobsAdded: 0, jobsExpired: 0 };
                dataMap[entry._id][field] += entry[field];
            }
        };
        addToMap(legacyAddedAgg, "jobsAdded");
        addToMap(v2AddedAgg, "jobsAdded");
        addToMap(legacyExpiredAgg, "jobsExpired");
        addToMap(v2ExpiredAgg, "jobsExpired");

        const startDate = periodStart || new Date("2020-01-01");
        const data = fillTimeSeries(dataMap, startDate, now, weekly);
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

        const dateGroupExpr = buildDateGroupExpr("timestamp", weekly);

        const legacyMatch = periodStart ? { timestamp: { $gte: periodStart } } : {};
        const v2Match = periodStart
            ? { eventType: "apply_click", timestamp: { $gte: periodStart } }
            : { eventType: "apply_click" };

        const [legacyClicksAgg, v2ClicksAgg] = await Promise.all([
            JobClickEvent.aggregate([
                { $match: legacyMatch },
                { $group: { _id: dateGroupExpr, clicks: { $sum: 1 } } },
            ]),
            JobClickV2.aggregate([
                { $match: v2Match },
                { $group: { _id: dateGroupExpr, clicks: { $sum: 1 } } },
            ]),
        ]);

        const dataMap = {};
        for (const entry of legacyClicksAgg) {
            if (!entry._id) continue;
            dataMap[entry._id] = { clicks: entry.clicks };
        }
        for (const entry of v2ClicksAgg) {
            if (!entry._id) continue;
            if (!dataMap[entry._id]) dataMap[entry._id] = { clicks: 0 };
            dataMap[entry._id].clicks += entry.clicks;
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

// Format a Jobdesc doc for top-jobs output
const formatLegacyJob = (job, clicks) => ({
    jobId: job._id,
    title: job.title,
    companyName: job.companyName,
    companyLogo: job.imagePath,
    location: job.location,
    clicks,
    isActive: job.isActive,
    createdAt: job.createdAt,
});

// Format a JobV2 doc for top-jobs output
const formatV2Job = (job, clicks) => {
    const firstLoc = Array.isArray(job.jobLocation) && job.jobLocation[0] ? job.jobLocation[0] : null;
    const locationStr = firstLoc
        ? [firstLoc.city, firstLoc.region].filter(Boolean).join(", ")
        : "";
    return {
        jobId: job._id,
        title: job.title,
        companyName: job.companyName,
        companyLogo: null,
        location: locationStr,
        clicks,
        isActive: job.status === "published",
        createdAt: job.createdAt,
    };
};

// GET /analytics/top-jobs
exports.getTopJobs = async (req, res) => {
    try {
        const period = req.query.period || "30d";
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
        const periodStart = getPeriodStart(period);

        let combined = [];

        if (!periodStart) {
            // "all" — read cached counts on the job docs
            const [legacyJobs, v2Jobs] = await Promise.all([
                Jobdesc.find({ totalclick: { $gt: 0 } })
                    .sort({ totalclick: -1 })
                    .limit(limit)
                    .select("title companyName imagePath location isActive createdAt totalclick")
                    .lean(),
                JobV2.find({ deletedAt: null, "stats.applyClicks": { $gt: 0 } })
                    .sort({ "stats.applyClicks": -1 })
                    .limit(limit)
                    .select("title companyName jobLocation status createdAt stats")
                    .lean(),
            ]);

            combined = [
                ...legacyJobs.map((j) => formatLegacyJob(j, j.totalclick || 0)),
                ...v2Jobs.map((j) => formatV2Job(j, j.stats?.applyClicks || 0)),
            ];
        } else {
            // Aggregate click events within period from both collections
            const [legacyTopClicks, v2TopClicks] = await Promise.all([
                JobClickEvent.aggregate([
                    { $match: { timestamp: { $gte: periodStart } } },
                    { $group: { _id: "$jobId", clicks: { $sum: 1 } } },
                    { $sort: { clicks: -1 } },
                    { $limit: limit },
                ]),
                JobClickV2.aggregate([
                    { $match: { eventType: "apply_click", timestamp: { $gte: periodStart } } },
                    { $group: { _id: "$job", clicks: { $sum: 1 } } },
                    { $sort: { clicks: -1 } },
                    { $limit: limit },
                ]),
            ]);

            const legacyIds = legacyTopClicks.map((c) => c._id);
            const v2Ids = v2TopClicks.map((c) => c._id);

            const [legacyJobs, v2Jobs] = await Promise.all([
                legacyIds.length
                    ? Jobdesc.find({ _id: { $in: legacyIds } })
                          .select("title companyName imagePath location isActive createdAt")
                          .lean()
                    : [],
                v2Ids.length
                    ? JobV2.find({ _id: { $in: v2Ids } })
                          .select("title companyName jobLocation status createdAt")
                          .lean()
                    : [],
            ]);

            const legacyMap = Object.fromEntries(legacyJobs.map((j) => [j._id.toString(), j]));
            const v2Map = Object.fromEntries(v2Jobs.map((j) => [j._id.toString(), j]));

            for (const click of legacyTopClicks) {
                const job = legacyMap[click._id.toString()];
                if (!job) continue;
                combined.push(formatLegacyJob(job, click.clicks));
            }
            for (const click of v2TopClicks) {
                const job = v2Map[click._id.toString()];
                if (!job) continue;
                combined.push(formatV2Job(job, click.clicks));
            }
        }

        combined.sort((a, b) => b.clicks - a.clicks);
        const data = combined.slice(0, limit);

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

        // Legacy aggregation
        const legacyPipeline = [{ $match: { isActive: true } }];
        if (groupBy === "tags") {
            legacyPipeline.push({ $unwind: "$tags" });
        }
        legacyPipeline.push(
            { $group: { _id: `$${groupBy}`, count: { $sum: 1 } } },
            { $project: { _id: 0, label: { $ifNull: ["$_id", "Unknown"] }, count: 1 } }
        );

        // V2 field mapping
        const v2FieldMap = {
            jobtype: "employmentType", // array
            workMode: "workMode",
            location: "jobLocation.city", // array of objects, needs unwind
            companytype: null, // not in V2
            tags: "topicTags", // array
        };
        const v2Field = v2FieldMap[groupBy];

        const v2Pipeline = [{ $match: { deletedAt: null, status: "published" } }];
        if (v2Field === "employmentType" || v2Field === "topicTags") {
            v2Pipeline.push({ $unwind: `$${v2Field}` });
            v2Pipeline.push({
                $group: { _id: `$${v2Field}`, count: { $sum: 1 } },
            });
        } else if (groupBy === "location") {
            v2Pipeline.push({ $unwind: "$jobLocation" });
            v2Pipeline.push({
                $group: { _id: "$jobLocation.city", count: { $sum: 1 } },
            });
        } else if (v2Field) {
            v2Pipeline.push({ $group: { _id: `$${v2Field}`, count: { $sum: 1 } } });
        }
        if (v2Field) {
            v2Pipeline.push({
                $project: { _id: 0, label: { $ifNull: ["$_id", "Unknown"] }, count: 1 },
            });
        }

        const [legacyAgg, v2Agg] = await Promise.all([
            Jobdesc.aggregate(legacyPipeline),
            v2Field ? JobV2.aggregate(v2Pipeline) : [],
        ]);

        // Normalize V2 employmentType values to match legacy jobtype labels
        const normalizeLabel = (label) => {
            if (groupBy !== "jobtype") return label;
            const map = {
                FULL_TIME: "fulltime",
                PART_TIME: "parttime",
                CONTRACTOR: "contract",
                INTERN: "internship",
                TEMPORARY: "temporary",
            };
            return map[label] || label;
        };

        const merged = {};
        for (const item of legacyAgg) {
            const label = item.label || "Unknown";
            merged[label] = (merged[label] || 0) + item.count;
        }
        for (const item of v2Agg) {
            const label = normalizeLabel(item.label || "Unknown");
            merged[label] = (merged[label] || 0) + item.count;
        }

        const data = Object.entries(merged)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count);

        return res.status(200).json({ success: true, groupBy, data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
