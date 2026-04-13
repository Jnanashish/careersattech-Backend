const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        slug: { type: String, required: true, unique: true },
        excerpt: { type: String },
        content: { type: String, required: true },
        contentHtml: { type: String },

        coverImage: {
            url: { type: String },
            alt: { type: String },
            width: { type: Number },
            height: { type: Number },
            blurhash: { type: String },
        },

        author: {
            name: { type: String, required: true },
            avatar: { type: String },
            bio: { type: String },
            social: { type: Map, of: String },
        },

        category: { type: String, required: true },
        tags: { type: [String], default: [] },

        seo: {
            metaTitle: { type: String },
            metaDescription: { type: String },
            canonicalUrl: { type: String },
            ogImage: { type: String },
            keywords: { type: [String], default: [] },
            noindex: { type: Boolean, default: false },
        },

        readingTime: { type: Number, default: 0 },
        wordCount: { type: Number, default: 0 },
        tableOfContents: [
            {
                id: { type: String },
                text: { type: String },
                level: { type: Number },
            },
        ],

        status: {
            type: String,
            enum: ["draft", "scheduled", "published", "archived"],
            default: "draft",
        },
        publishedAt: { type: Date },
        scheduledFor: { type: Date },

        views: { type: Number, default: 0 },
    },
    { timestamps: true }
);

blogSchema.index({ slug: 1 }, { unique: true });
blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ category: 1 });

const Blog = mongoose.model("Blog", blogSchema);

module.exports = Blog;
