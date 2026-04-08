const Blog = require("./blog.schema");
const { processMarkdown } = require("./markdown.service");
const { downloadAndReupload } = require("./cloudinary.service");

/**
 * Generate a URL-safe slug from a title string.
 */
function slugify(title) {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Ensure slug uniqueness by appending -2, -3, etc. if needed.
 */
async function uniqueSlug(slug, excludeId) {
    let candidate = slug;
    let suffix = 1;
    const query = excludeId ? { slug: candidate, _id: { $ne: excludeId } } : { slug: candidate };

    while (await Blog.exists({ ...query, slug: candidate })) {
        suffix++;
        candidate = `${slug}-${suffix}`;
    }
    return candidate;
}

/**
 * Find and replace external image URLs in markdown content with Cloudinary URLs.
 * Returns the updated markdown string.
 */
async function replaceExternalImages(markdown) {
    // Match markdown images: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];

    if (matches.length === 0) return markdown;

    // Skip URLs already on Cloudinary
    const cloudinaryHost = "res.cloudinary.com";
    const toReplace = matches.filter((m) => !m[2].includes(cloudinaryHost));

    if (toReplace.length === 0) return markdown;

    let result = markdown;
    // Process sequentially to avoid rate limits
    for (const match of toReplace) {
        const originalUrl = match[2];
        try {
            const uploaded = await downloadAndReupload(originalUrl);
            result = result.replace(originalUrl, uploaded.url);
        } catch (err) {
            console.warn(`[BlogService] Failed to re-upload image ${originalUrl}:`, err.message);
            // Keep original URL on failure
        }
    }

    return result;
}

/**
 * Strip markdown formatting for plain text extraction.
 */
function stripMarkdown(text) {
    return text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[#*_~>`|-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Main processing pipeline for blog posts. Called on create and update.
 *
 * @param {object} data - The blog data from the request body
 * @param {object} [existingPost] - The existing blog document (for updates)
 * @returns {Promise<object>} Processed blog data ready for save
 */
async function processBlogPost(data, existingPost = null) {
    const processed = { ...data };

    // 1. Slug generation
    if (data.title && (!existingPost || data.title !== existingPost.title) && !data.slug) {
        processed.slug = await uniqueSlug(
            slugify(data.title),
            existingPost?._id
        );
    } else if (data.slug) {
        processed.slug = await uniqueSlug(
            slugify(data.slug),
            existingPost?._id
        );
    }

    // 2. Process markdown if content changed
    if (data.content) {
        // 3. Replace external image URLs with Cloudinary
        processed.content = await replaceExternalImages(data.content);

        // Parse markdown to HTML + extract metadata
        const { html, tableOfContents, wordCount, readingTime } = await processMarkdown(processed.content);
        processed.contentHtml = html;
        processed.tableOfContents = tableOfContents;
        processed.wordCount = wordCount;
        processed.readingTime = readingTime;
    }

    // 4. Auto-generate excerpt if empty
    if (!processed.excerpt && !existingPost?.excerpt && data.content) {
        processed.excerpt = stripMarkdown(data.content).slice(0, 160);
    }

    // 5. Auto-fill SEO fields
    const seo = { ...(existingPost?.seo?.toObject?.() || existingPost?.seo || {}), ...(data.seo || {}) };
    if (!seo.metaTitle) seo.metaTitle = processed.title || existingPost?.title;
    if (!seo.metaDescription) seo.metaDescription = processed.excerpt || existingPost?.excerpt;
    if (!seo.ogImage) {
        seo.ogImage = processed.coverImage?.url || existingPost?.coverImage?.url;
    }
    processed.seo = seo;

    return processed;
}

module.exports = { processBlogPost, slugify, uniqueSlug };
