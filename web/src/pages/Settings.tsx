import { motion } from 'framer-motion';
import { APP_VERSION } from '../components/layout/VersionBanner';
import { Palette, Database, Info, Github } from 'lucide-react';
import { AppearanceSettings, ThemePreview } from '../components/settings/AppearanceSettings';
import BackupRestore from '../components/accounts/BackupRestore';
import { PageHeader } from '../components/common/Misc';
import { listContainer, listItem } from '../lib/motion';

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="设置" description="外观、数据与关于 —— 外观偏好仅保存在本浏览器" />
      <motion.div variants={listContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <motion.section variants={listItem} id="appearance" className="card sf-low p-6">
            <SectionTitle icon={Palette} title="外观" desc="Material You 动态取色：从种子色或壁纸生成完整的亮/暗配色" />
            <AppearanceSettings />
          </motion.section>
          <motion.section variants={listItem} className="card sf-low p-6">
            <SectionTitle icon={Database} title="数据" desc="下载 SQLite 备份或从备份恢复（恢复后需重启服务）" />
            <div className="flex flex-wrap gap-2"><BackupRestore variant="tonal" /></div>
          </motion.section>
          <motion.section variants={listItem} className="card sf-low p-6">
            <SectionTitle icon={Info} title="关于" desc={`Mail Manager v${APP_VERSION} · 合并版（Outlook OAuth + 多服务商 IMAP）`} />
            <a href="https://github.com/keh4l/outlook-mail-manager" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-label-l text-primary hover:underline">
              <Github className="size-4" />上游项目
            </a>
          </motion.section>
        </div>
        <motion.div variants={listItem} className="xl:col-span-2">
          <div className="xl:sticky xl:top-8"><ThemePreview /></div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container"><Icon className="size-5" /></span>
      <div>
        <h2 className="text-title-l text-on-surface">{title}</h2>
        <p className="mt-0.5 text-body-m text-on-surface-variant">{desc}</p>
      </div>
    </div>
  );
}
