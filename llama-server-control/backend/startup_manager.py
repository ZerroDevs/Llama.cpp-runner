import os
import sys
import winreg

class StartupManager:
    APP_NAME = "LlamaServerControl"

    @staticmethod
    def get_executable_path():
        if getattr(sys, 'frozen', False):
            return f'"{sys.executable}" --startup'
        else:
            # If running from python script, we need python.exe and the script path
            script_path = os.path.abspath(sys.argv[0])
            python_exe = sys.executable
            return f'"{python_exe}" "{script_path}" --startup'

    @staticmethod
    def enable_startup():
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, StartupManager.APP_NAME, 0, winreg.REG_SZ, StartupManager.get_executable_path())
            winreg.CloseKey(key)
            return True
        except Exception as e:
            print(f"Failed to enable startup: {e}")
            return False

    @staticmethod
    def disable_startup():
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
            winreg.DeleteValue(key, StartupManager.APP_NAME)
            winreg.CloseKey(key)
            return True
        except FileNotFoundError:
            return True
        except Exception as e:
            print(f"Failed to disable startup: {e}")
            return False
            
    @staticmethod
    def is_enabled():
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ)
            value, _ = winreg.QueryValueEx(key, StartupManager.APP_NAME)
            winreg.CloseKey(key)
            return value == StartupManager.get_executable_path()
        except FileNotFoundError:
            return False
        except Exception:
            return False
