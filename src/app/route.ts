export async function GET() {
    return Response.json({
        name: "life",
        endpoints: ["/dark.gif", "/light.gif"],
    }, {
        headers: { "Cache-Control": "public, max-age=3600" },
    });
}
