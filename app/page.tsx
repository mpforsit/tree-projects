import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { userTenants } from "@/lib/tenants";

/** Post-login fan-out (spec §8.3): 0 tenants → dead end, 1 → straight in,
 *  several → picker. */
export default async function Home() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenants = await userTenants(user.id);
  if (tenants.length === 0) redirect("/no-access");
  if (tenants.length === 1) redirect(`/${tenants[0]!.slug}`);
  redirect("/select");
}
