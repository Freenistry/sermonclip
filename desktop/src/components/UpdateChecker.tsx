import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

export function UpdateChecker() {
  const checked = useRef(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    check()
      .then((update) => {
        if (!update) return;
        showUpdateToast(update);
      })
      .catch((err) => {
        console.warn("Update check failed:", err);
      });
  }, []);

  function showUpdateToast(update: Update) {
    toast(`Update available: v${update.version}`, {
      description: "A new version of SermonClip is ready to install.",
      duration: Infinity,
      action: {
        label: downloading ? "Downloading..." : "Install & Restart",
        onClick: () => installUpdate(update),
      },
    });
  }

  async function installUpdate(update: Update) {
    if (downloading) return;
    setDownloading(true);

    const toastId = toast.loading("Downloading update...");

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          toast.loading("Downloading update...", { id: toastId });
        } else if (event.event === "Finished") {
          toast.loading("Installing update...", { id: toastId });
        }
      });

      toast.success("Update installed! Restarting...", { id: toastId });
      await relaunch();
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Update failed. Please try again later.", { id: toastId });
      setDownloading(false);
    }
  }

  return null;
}
