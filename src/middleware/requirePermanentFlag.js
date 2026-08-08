/**
 * Guard for irreversible DELETE routes.
 *
 * Every admin resource exposes both a reversible `POST /:id/archive` and a
 * permanent `DELETE /:id`. Because the destructive one is a bare HTTP verb, a
 * mistyped curl, a stale bookmark, or a client that still thinks DELETE means
 * "archive" could wipe a document with no confirmation step. Requiring an
 * explicit `?permanent=true` makes the caller state intent in the URL, so the
 * dangerous call can never be made by accident.
 *
 * Archive routes are unaffected — this only ever guards hard deletes.
 */
function requirePermanentFlag(req, res, next) {
    if (req.query.permanent !== "true") {
        return res.status(400).json({
            error: "Permanent delete requires ?permanent=true. Use POST /:id/archive for a reversible archive.",
        });
    }
    next();
}

module.exports = requirePermanentFlag;
