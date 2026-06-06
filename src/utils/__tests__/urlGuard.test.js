const {
    isPublicHttpsUrl,
    isPublicHttpUrl,
    isPrivateHost,
    isPrivateIp,
} = require("../urlGuard");

describe("urlGuard.isPrivateHost", () => {
    test.each([
        "localhost",
        "LOCALHOST",
        "foo.localhost",
        "service.internal",
        "printer.local",
        "metadata.google.internal",
        "metadata",
        "127.0.0.1",
        "10.1.2.3",
        "192.168.0.1",
        "172.16.5.5",
        "172.31.255.255",
        "169.254.169.254", // cloud metadata
        "100.64.0.1", // CGNAT
        "0.0.0.0",
        // encoded IPv4 forms that all resolve to 127.0.0.1
        "2130706433", // decimal
        "0x7f000001", // hex
        "0177.0.0.1", // octal first octet
        "127.1", // short form
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "fd12:3456::1",
        "::ffff:127.0.0.1", // IPv4-mapped loopback
    ])("flags %s as private", (host) => {
        expect(isPrivateHost(host)).toBe(true);
    });

    test.each([
        "example.com",
        "careers.google.com",
        "8.8.8.8",
        "1.1.1.1",
        "203.0.113.10",
        "[2606:4700:4700::1111]",
        "api.scraperapi.com",
    ])("treats %s as public", (host) => {
        expect(isPrivateHost(host)).toBe(false);
    });
});

describe("urlGuard.isPublicHttpsUrl", () => {
    test("accepts a public https URL", () => {
        expect(isPublicHttpsUrl("https://example.com/jobs/1")).toBe(true);
    });
    test("rejects http (non-TLS)", () => {
        expect(isPublicHttpsUrl("http://example.com")).toBe(false);
    });
    test.each([
        "https://127.0.0.1/admin",
        "https://localhost:8080",
        "https://169.254.169.254/latest/meta-data/",
        "https://2130706433/", // decimal-encoded 127.0.0.1
        "https://0x7f000001/", // hex-encoded 127.0.0.1
        "https://[::1]/",
    ])("rejects private/encoded target %s", (url) => {
        expect(isPublicHttpsUrl(url)).toBe(false);
    });
    test("rejects garbage", () => {
        expect(isPublicHttpsUrl("not a url")).toBe(false);
    });
});

describe("urlGuard.isPublicHttpUrl", () => {
    test("accepts both http and https public URLs", () => {
        expect(isPublicHttpUrl("http://example.com")).toBe(true);
        expect(isPublicHttpUrl("https://example.com")).toBe(true);
    });
    test("rejects non-HTTP schemes", () => {
        expect(isPublicHttpUrl("javascript:alert(1)")).toBe(false);
        expect(isPublicHttpUrl("data:text/html,x")).toBe(false);
        expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
        expect(isPublicHttpUrl("mailto:hr@example.com")).toBe(false);
    });
    test("rejects private hosts regardless of scheme", () => {
        expect(isPublicHttpUrl("http://169.254.169.254/")).toBe(false);
        expect(isPublicHttpUrl("http://localhost/")).toBe(false);
    });
});

describe("urlGuard.isPrivateIp", () => {
    test("classifies resolved IPv4 addresses", () => {
        expect(isPrivateIp("127.0.0.1")).toBe(true);
        expect(isPrivateIp("169.254.169.254")).toBe(true);
        expect(isPrivateIp("10.0.0.1")).toBe(true);
        expect(isPrivateIp("8.8.8.8")).toBe(false);
    });
    test("classifies resolved IPv6 addresses", () => {
        expect(isPrivateIp("::1")).toBe(true);
        expect(isPrivateIp("fe80::1")).toBe(true);
        expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    });
});
