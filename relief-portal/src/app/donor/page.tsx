import { redirect } from "next/navigation";

/** The donor portal opens on the donate form. */
export default function DonorHome() {
  redirect("/donor/donate");
}
