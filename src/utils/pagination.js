function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
    const rawPage = parseInt(query.page, 10);
    const rawLimit = parseInt(query.limit ?? query.size, 10);
    const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
    const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta({ page, limit, total }) {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    return { page, limit, total, totalPages };
}

module.exports = { parsePagination, paginationMeta };
