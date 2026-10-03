const translations = {
    en: {
        app_title: "Llama Server Control",
        status_stopped: "Stopped",
        status_running: "Running",
        nav_main: "Server & Models",
        nav_tuning: "Performance Tuning",
        nav_logs: "Live Logs",
        nav_about: "About & Guides",
        banner_binary_title: "llama-server.exe is missing!",
        banner_binary_desc: "Please select the required CUDA 12 build binary.",
        btn_locate: "Locate llama-server.exe",
        lbl_binary: "Server Binary",
        lbl_model: "Model Path (-m)",
        lbl_vision: "Vision Projector (-mmproj) <span class='text-xs text-textMuted font-normal ml-2'>(Optional)</span>",
        btn_browse: "Browse",
        lbl_context: "Context Size (-c)",
        lbl_port: "Port (--port)",
        lbl_flash_attn: "Flash Attention (-fa)",
        desc_flash_attn: "Improves performance on supported GPUs",
        lbl_gpu_layers: "GPU Offload Layers (-ngl)",
        lbl_threads: "CPU Threads (-t)",
        lbl_host: "Host Binding (--host)",
        lbl_kv_k: "KV Cache Quantization K (-ctk)",
        lbl_kv_v: "KV Cache Quantization V (-ctv)",
        lbl_batch: "Logical Batch Size (-b)",
        lbl_ubatch: "Physical Batch Size (-ub)",
        lbl_api_key: "API Key (--api-key)",
        lbl_custom_args: "Custom CLI Arguments",
        title_logs: "Live Server Console",
        lbl_autoscroll: "Auto-scroll",
        btn_copy: "Copy All",
        btn_clear: "Clear",
        about_title: "Llama Server Control",
        about_desc1: "A modern, ultra-lightweight, and headless desktop GUI runner for llama.cpp's server binary on Windows.",
        about_desc2: "To achieve maximum performance on NVIDIA RTX GPUs, ensure you are using a binary built with CUDA support.",
        about_integration: "API Integration Example (cURL)",
        btn_webchat: "Web Chat",
        btn_copyurl: "Copy URL",
        btn_start: "Start Server",
        btn_stop: "Stop Server",
        toast_copied: "Copied!"
    },
    ar: {
        app_title: "متحكم خادم لاما",
        status_stopped: "متوقف",
        status_running: "قيد التشغيل",
        nav_main: "الخادم والنماذج",
        nav_tuning: "ضبط الأداء",
        nav_logs: "السجلات المباشرة",
        nav_about: "حول والأدلة",
        banner_binary_title: "ملف llama-server.exe مفقود!",
        banner_binary_desc: "يرجى تحديد الملف المطلوب المبني بدعم CUDA 12.",
        btn_locate: "تحديد مسار الملف",
        lbl_binary: "ملف الخادم (Binary)",
        lbl_model: "مسار النموذج (-m)",
        lbl_vision: "عارض الرؤية (-mmproj) <span class='text-xs text-textMuted font-normal mr-2'>(اختياري)</span>",
        btn_browse: "تصفح",
        lbl_context: "حجم السياق (-c)",
        lbl_port: "المنفذ (--port)",
        lbl_flash_attn: "الانتباه السريع (-fa)",
        desc_flash_attn: "يحسن الأداء على وحدات معالجة الرسومات المدعومة",
        lbl_gpu_layers: "طبقات وحدة معالجة الرسومات (-ngl)",
        lbl_threads: "خيوط المعالج (-t)",
        lbl_host: "ربط المضيف (--host)",
        lbl_kv_k: "التكميم لذاكرة KV نوع K (-ctk)",
        lbl_kv_v: "التكميم لذاكرة KV نوع V (-ctv)",
        lbl_batch: "حجم الدفعة المنطقية (-b)",
        lbl_ubatch: "حجم الدفعة المادية (-ub)",
        lbl_api_key: "مفتاح API (--api-key)",
        lbl_custom_args: "وسائط سطر الأوامر المخصصة",
        title_logs: "وحدة تحكم الخادم المباشرة",
        lbl_autoscroll: "تمرير تلقائي",
        btn_copy: "نسخ الكل",
        btn_clear: "مسح",
        about_title: "متحكم خادم لاما",
        about_desc1: "برنامج واجهة حديث وخفيف الوزن ومخفي لتشغيل خادم llama.cpp على نظام Windows.",
        about_desc2: "لتحقيق أقصى أداء على بطاقات NVIDIA RTX، تأكد من استخدام ملف مبني بدعم CUDA.",
        about_integration: "مثال على دمج API (cURL)",
        btn_webchat: "دردشة الويب",
        btn_copyurl: "نسخ الرابط",
        btn_start: "تشغيل الخادم",
        btn_stop: "إيقاف الخادم",
        toast_copied: "تم النسخ!"
    }
};

let currentLang = 'en';

function applyTranslations(lang) {
    currentLang = lang;
    const dict = translations[lang] || translations.en;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.innerHTML = dict[key];
        }
    });

    const html = document.documentElement;
    if (lang === 'ar') {
        html.setAttribute('dir', 'rtl');
        document.getElementById('font-link').href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";
    } else {
        html.setAttribute('dir', 'ltr');
        document.getElementById('font-link').href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&display=swap";
    }
}
