import { connection } from "next/server";
import { gifResponse } from "@/lib/gifroute";

export const revalidate = 1;

export async function GET() {
    await connection();
    return gifResponse("dark");
}
