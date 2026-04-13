/**
 * Markdown → sanitized HTML processing pipeline.
 *
 * unified ecosystem is ESM-only; we use dynamic import() with cached modules.
 */

let _pipeline = null;
let _visit = null;
let _toString = null;

async function loadModules() {
    if (_pipeline) return;

    const [
        { unified },
        remarkParse,
        remarkRehype,
        rehypeSanitize,
        rehypeSlug,
        rehypeAutolinkHeadings,
        rehypeStringify,
        { defaultSchema },
    ] = await Promise.all([
        import("unified"),
        import("remark-parse").then((m) => m.default),
        import("remark-rehype").then((m) => m.default),
        import("rehype-sanitize").then((m) => m.default),
        import("rehype-slug").then((m) => m.default),
        import("rehype-autolink-headings").then((m) => m.default),
        import("rehype-stringify").then((m) => m.default),
        import("rehype-sanitize"),
    ]);

    // Try to load rehype-prism-plus for code highlighting; skip if unavailable
    let rehypePrism = null;
    try {
        rehypePrism = (await import("rehype-prism-plus")).default;
    } catch {
        console.warn("[Markdown] rehype-prism-plus not available, skipping syntax highlighting");
    }

    const { visit } = await import("unist-util-visit");
    const { toString } = await import("hast-util-to-string");

    // Extend default sanitize schema to allow YouTube/Vimeo iframes and code classes
    const sanitizeSchema = {
        ...defaultSchema,
        tagNames: [...(defaultSchema.tagNames || []), "iframe"],
        attributes: {
            ...defaultSchema.attributes,
            iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen", "title"],
            code: [...(defaultSchema.attributes?.code || []), "className"],
            span: [...(defaultSchema.attributes?.span || []), "className"],
        },
    };

    let pipeline = unified()
        .use(remarkParse)
        .use(remarkRehype, { allowDangerousHtml: false })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, { behavior: "wrap" });

    if (rehypePrism) {
        pipeline = pipeline.use(rehypePrism, { ignoreMissing: true });
    }

    pipeline = pipeline
        .use(rehypeSanitize, sanitizeSchema)
        .use(rehypeStringify);

    _pipeline = pipeline;
    _visit = visit;
    _toString = toString;
}

/**
 * Sanitize iframe src — only allow YouTube and Vimeo embeds.
 */
function sanitizeIframes(html) {
    return html.replace(
        /<iframe\s[^>]*src="([^"]*)"[^>]*>/gi,
        (match, src) => {
            const allowed = /^https:\/\/(www\.)?(youtube\.com\/embed\/|player\.vimeo\.com\/video\/)/i;
            return allowed.test(src) ? match : "";
        }
    );
}

/**
 * Process raw markdown into sanitized HTML with table of contents.
 *
 * @param {string} markdown - Raw markdown content
 * @returns {Promise<{html: string, tableOfContents: Array, wordCount: number, readingTime: number}>}
 */
async function processMarkdown(markdown) {
    await loadModules();

    // Build AST to extract TOC before stringifying
    const tree = _pipeline.parse(markdown);
    const transformedTree = await _pipeline.run(tree);

    const tableOfContents = [];
    _visit(transformedTree, "element", (node) => {
        if (node.tagName === "h2" || node.tagName === "h3") {
            const id = node.properties?.id;
            const text = _toString(node);
            if (id && text) {
                tableOfContents.push({
                    id,
                    text,
                    level: node.tagName === "h2" ? 2 : 3,
                });
            }
        }
    });

    let html = _pipeline.stringify(transformedTree);
    html = sanitizeIframes(html);

    // Word count from raw markdown (strip markdown syntax artifacts)
    const plainText = markdown
        .replace(/```[\s\S]*?```/g, " ")  // code blocks
        .replace(/`[^`]*`/g, " ")          // inline code
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images
        .replace(/[#*_~>`|-]/g, " ");       // markdown chars
    const words = plainText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200));

    return { html, tableOfContents, wordCount, readingTime };
}

module.exports = { processMarkdown };
