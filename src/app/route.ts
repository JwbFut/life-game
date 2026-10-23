export async function GET() {
    return Response.json({
        name: "life",
        endpoints: ["/dark.gif", "/light.gif"],
    });
}
