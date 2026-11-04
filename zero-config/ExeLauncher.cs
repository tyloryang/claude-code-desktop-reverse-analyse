using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ClaudeThirdParty {
  internal static class ExeLauncher {
    private static Label status;
    private static ProgressBar progress;

    [STAThread]
    private static int Main(string[] arguments) {
      AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
      AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
      Application.EnableVisualStyles();
      bool extractOnly = arguments.Length == 1 && arguments[0] == "--extract-only";
      if (arguments.Length != 0 && !extractOnly) {
        MessageBox.Show("Supported option: --extract-only", "Claude Third-Party");
        return 2;
      }
      string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Claude-ThirdParty-ZeroConfig");
      try {
        Directory.CreateDirectory(root);
        string digest;
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.sha256"))
        using (StreamReader reader = new StreamReader(stream)) {
          digest = reader.ReadToEnd().Trim().ToLowerInvariant();
        }
        if (digest.Length != 64 || !System.Text.RegularExpressions.Regex.IsMatch(digest, "^[a-f0-9]+$")) {
          throw new InvalidDataException("Invalid embedded payload identity.");
        }
        string destination = Path.Combine(root, "versions", digest.Substring(0, 16));
        string mutexName = "Local\\ClaudeThirdParty-" + WindowsIdentity.GetCurrent().User.Value + "-" + digest;
        using (Mutex mutex = new Mutex(false, mutexName)) {
          bool acquired;
          try { acquired = mutex.WaitOne(TimeSpan.FromMinutes(5)); }
          catch (AbandonedMutexException) { acquired = true; }
          if (!acquired) throw new TimeoutException("Another extraction is still running. Try again later.");
          try {
            if (!IsReady(destination, digest)) Extract(destination, digest);
          } finally { mutex.ReleaseMutex(); }
        }
        if (!extractOnly) {
          string executable = Path.Combine(destination, "app", "Claude.exe");
          ProcessStartInfo start = new ProcessStartInfo(executable);
          start.WorkingDirectory = Path.GetDirectoryName(executable);
          start.UseShellExecute = false;
          Process child = Process.Start(start);
          if (child == null) throw new InvalidOperationException("The application could not be started.");
          File.AppendAllText(Path.Combine(root, "launcher.log"), DateTime.UtcNow.ToString("o") + " started pid=" + child.Id + " build=" + digest + Environment.NewLine);
          child.Dispose();
        }
        return 0;
      } catch (Exception error) {
        try { File.AppendAllText(Path.Combine(root, "launcher.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine); } catch { }
        MessageBox.Show(error.Message + "\n\nLog: " + Path.Combine(root, "launcher.log"), "Claude Third-Party startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
      }
    }

    private static bool IsReady(string directory, string digest) {
      string marker = Path.Combine(directory, ".ready");
      return File.Exists(marker) && File.ReadAllText(marker).Trim() == digest &&
        File.Exists(Path.Combine(directory, "app", "Claude.exe")) &&
        File.Exists(Path.Combine(directory, "app", "resources", "app.asar"));
    }

    private static void Extract(string destination, string digest) {
      if (Directory.Exists(destination)) {
        throw new IOException("An incomplete application cache exists. Close Claude Third-Party, remove this folder, then retry:\n" + destination);
      }
      Directory.CreateDirectory(Path.GetDirectoryName(destination));
      string staging = destination + ".staging-" + Guid.NewGuid().ToString("N");
      Directory.CreateDirectory(staging);
      using (Form window = new Form()) {
        window.Text = "Claude Third-Party - First launch";
        window.ClientSize = new System.Drawing.Size(460, 110);
        window.StartPosition = FormStartPosition.CenterScreen;
        window.FormBorderStyle = FormBorderStyle.FixedDialog;
        window.ControlBox = false;
        status = new Label { Left = 16, Top = 15, Width = 428, Height = 38, Text = "Verifying and extracting application... No certificate installation." };
        progress = new ProgressBar { Left = 16, Top = 65, Width = 428, Height = 20 };
        window.Controls.Add(status);
        window.Controls.Add(progress);
        window.Show();
        Application.DoEvents();
        try {
          using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
            using (SHA256 hash = SHA256.Create()) {
              string actual = BitConverter.ToString(hash.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
              if (actual != digest) throw new InvalidDataException("The embedded payload checksum does not match.");
            }
            payload.Position = 0;
            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read)) {
              string prefix = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
              progress.Maximum = archive.Entries.Count;
              foreach (ZipArchiveEntry entry in archive.Entries) {
                string target = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                  throw new InvalidDataException("Invalid path inside the application archive.");
                }
                if (entry.Name.Length == 0) Directory.CreateDirectory(target);
                else {
                  Directory.CreateDirectory(Path.GetDirectoryName(target));
                  using (Stream input = entry.Open())
                  using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) {
                    input.CopyTo(output);
                  }
                }
                progress.Value++;
                Application.DoEvents();
              }
            }
          }
          if (!File.Exists(Path.Combine(staging, "app", "Claude.exe")) ||
              !File.Exists(Path.Combine(staging, "app", "resources", "app.asar"))) {
            throw new InvalidDataException("The application payload is incomplete.");
          }
          File.WriteAllText(Path.Combine(staging, ".ready"), digest, Encoding.ASCII);
          Directory.Move(staging, destination);
        } finally {
          if (Directory.Exists(staging)) Directory.Delete(staging, true);
          window.Close();
        }
      }
    }
  }
}
