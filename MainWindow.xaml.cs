using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using LlamaServerControl.Backend;

namespace LlamaServerControl
{
    public partial class MainWindow : Window
    {
        private ConfigManager _configManager = null!;
        private ProcessManager _processManager = null!;
        private SwarmManager _swarmManager = null!;
        private HardwareMonitor _hardwareMonitor = null!;
        private HubManager _hubManager = null!;
        private VoiceStudioService _voiceStudioService = null!;
        private NativeBridge _nativeBridge = null!;
        private StreamingProxy _streamingProxy = null!;
        private WebHostServer _webHostServer = null!;

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            Closing += MainWindow_Closing;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string parentDir = Directory.GetParent(appDir)?.Parent?.Parent?.Parent?.FullName ?? appDir;
            string configPath = Path.Combine(parentDir, "config.json");
            if (!File.Exists(configPath))
            {
                configPath = Path.Combine(appDir, "config.json");
            }

            _configManager = new ConfigManager(configPath);
            _processManager = new ProcessManager();
            _swarmManager = new SwarmManager();
            _hardwareMonitor = new HardwareMonitor();
            _hubManager = new HubManager();

            _streamingProxy = new StreamingProxy(_processManager, _configManager, _swarmManager, _hardwareMonitor);
            _streamingProxy.Start();

            // Locate UI directory (prioritize source dev directory for instant live updates)
            string devUiDir = Path.Combine(parentDir, "ui");
            string uiDir = Directory.Exists(devUiDir) ? devUiDir : Path.Combine(appDir, "ui");

            _voiceStudioService = new VoiceStudioService(_configManager, uiDir);

            _nativeBridge = new NativeBridge(_configManager, _processManager, _swarmManager, _hardwareMonitor, _hubManager, _streamingProxy, null, _voiceStudioService);

            // Set window and taskbar icon safely from file if present
            try
            {
                string iconPath = Path.Combine(uiDir, "images", "Icon.ico");
                if (File.Exists(iconPath))
                {
                    Icon = System.Windows.Media.Imaging.BitmapFrame.Create(
                        new Uri(iconPath, UriKind.Absolute),
                        System.Windows.Media.Imaging.BitmapCreateOptions.None,
                        System.Windows.Media.Imaging.BitmapCacheOption.OnLoad
                    );
                }
            }
            catch { }

            // Start WebHostServer on port 9095 (Local & Network Host)
            _webHostServer = new WebHostServer(_nativeBridge, _configManager, _processManager, _streamingProxy, uiDir, _voiceStudioService);
            _webHostServer.Start();

            // Initialize WebView2 with security flags permitting local loopback HTTP assets & mixed content
            var envOptions = new CoreWebView2EnvironmentOptions(
                "--disable-web-security --allow-running-insecure-content --disable-features=BlockInsecurePrivateNetworkRequests"
            );
            var env = await CoreWebView2Environment.CreateAsync(null, null, envOptions);
            await webView.EnsureCoreWebView2Async(env);

            _nativeBridge.SetWebView(webView.CoreWebView2);

            // Virtual host mapping for 0 latency local loading
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.local",
                uiDir,
                CoreWebView2HostResourceAccessKind.Allow
            );

            webView.CoreWebView2.WebMessageReceived += async (s, args) =>
            {
                try
                {
                    string messageJson = args.WebMessageAsJson;
                    string responseJson = await _nativeBridge.HandleMessageAsync(messageJson);
                    if (!Dispatcher.CheckAccess())
                    {
                        await Dispatcher.InvokeAsync(() => webView.CoreWebView2.PostWebMessageAsJson(responseJson));
                    }
                    else
                    {
                        webView.CoreWebView2.PostWebMessageAsJson(responseJson);
                    }
                }
                catch { }
            };

            webView.CoreWebView2.Navigate("https://app.local/index.html");
        }

        private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            // Instant 0ms window hide
            Hide();

            // Background async shutdown
            Task.Run(() =>
            {
                try
                {
                    _processManager.StopServer();
                    _swarmManager.StopSwarm();
                    _streamingProxy.Stop();
                    _webHostServer.Stop();
                }
                catch { }
                finally
                {
                    Environment.Exit(0);
                }
            });
        }
    }
}