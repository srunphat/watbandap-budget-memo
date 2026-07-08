/**
 * Budget & Activity Approval Memo Web Application
 * school: โรงเรียนวัดบ้านดาบ
 * director: นายศรัณย์ภัทร กาญจนาคม
 * Cloud DB: Google Sheets Backend Integration
 */

// Global Application Instance
const app = {
    // State
    projects: [],
    settings: {
        schoolName: "โรงเรียนวัดบ้านดาบ",
        directorName: "นายศรัณย์ภัทร กาญจนาคม",
        directorPos: "ผู้อำนวยการโรงเรียนวัดบ้านดาบ"
    },
    dbUrl: null, // Google Sheets Apps Script Web App URL
    currentTab: "dashboard",
    expenseItems: [], // Items for currently editing memo
    attachedFiles: [], // PDF or Image attachments loaded in memo
    cachedCloudFileId: null, // Google Drive File ID currently cached
    cachedCloudFileData: null, // File object parsed from Base64
    cachedCloudPrintFileId: null, // Google Drive File ID currently cached for print tab
    cachedCloudPrintFileData: null, // File object parsed from Base64 for print tab
    
    // Initializer
    init: function() {
        this.loadSettings();
        this.loadProjects();
        this.setupEventListeners();
        this.renderDashboard();
        this.renderProjectsList();
        this.populateMemoDropdowns();
        this.addDefaultExpenseRowIfEmpty();
        this.updateMemoPreview();
        
        // Sync from cloud database on startup if configured
        if (this.dbUrl) {
            this.verifyCloudConnection(true); // Silent sync on load
        }
    },

    // Load School Settings
    loadSettings: function() {
        const savedSettings = localStorage.getItem("school_settings");
        if (savedSettings) {
            this.settings = JSON.parse(savedSettings);
        }
        
        // Load cloud DB URL configuration
        this.dbUrl = localStorage.getItem("db_url") || null;
        
        // Apply settings to form inputs
        document.getElementById("setting-school-name").value = this.settings.schoolName;
        document.getElementById("setting-director-name").value = this.settings.directorName;
        document.getElementById("setting-director-pos").value = this.settings.directorPos;
        document.getElementById("setting-db-url").value = this.dbUrl || "";
        
        // Prefill memo fields
        document.getElementById("memo-agency").value = this.settings.schoolName;
        document.getElementById("memo-approver-name").value = this.settings.directorName;
        document.getElementById("memo-approver-pos").value = this.settings.directorPos;
        
        // Update sidebar
        document.querySelector(".badge-name").textContent = "ผอ. " + this.settings.directorName.replace("นาย", "").replace("นาง", "").replace("นางสาว", "");
    },

    // Save School Settings
    saveSettings: function() {
        this.settings.schoolName = document.getElementById("setting-school-name").value.trim();
        this.settings.directorName = document.getElementById("setting-director-name").value.trim();
        this.settings.directorPos = document.getElementById("setting-director-pos").value.trim();
        
        localStorage.setItem("school_settings", JSON.stringify(this.settings));
        
        // Refresh UI
        this.loadSettings();
        alert("บันทึกข้อมูลสถานศึกษาเรียบร้อยแล้ว");
    },

    // Load Projects Data
    loadProjects: function() {
        const savedProjects = localStorage.getItem("school_projects");
        if (savedProjects) {
            this.projects = JSON.parse(savedProjects);
        } else {
            this.projects = [];
        }
    },

    // Save Projects Data
    saveProjects: function() {
        localStorage.setItem("school_projects", JSON.stringify(this.projects));
        this.renderDashboard();
        this.renderProjectsList();
        this.populateMemoDropdowns();
        this.populatePrintProjectDropdown();

        // Push updates to cloud if online database is configured
        if (this.dbUrl) {
            this.syncToCloud();
        }
    },

    // Switch active navigation tab
    switchTab: function(tabName) {
        this.currentTab = tabName;
        
        // Update sidebar navigation buttons
        document.querySelectorAll(".nav-btn").forEach(btn => {
            if (btn.getAttribute("data-tab") === tabName) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
        
        // Show/hide sections
        document.querySelectorAll(".tab-content").forEach(section => {
            if (section.id === `tab-${tabName}`) {
                section.classList.add("active");
            } else {
                section.classList.remove("active");
            }
        });

        // Trigger updates if switching to Memo Tab or Print Project Tab
        if (tabName === "memo-creator") {
            this.populateMemoDropdowns();
            this.updateMemoPreview();
            setTimeout(() => this.adjustPreviewScale(), 50); // Scale preview to fit screen width
        } else if (tabName === "project-print") {
            this.populatePrintProjectDropdown();
            setTimeout(() => this.adjustPrintPreviewScale(), 50);
        }
    },

    // Setup Event Listeners
    setupEventListeners: function() {
        const self = this;
        
        // Sidebar tab navigation
        document.querySelectorAll(".nav-btn").forEach(btn => {
            btn.addEventListener("click", function() {
                self.switchTab(this.getAttribute("data-tab"));
            });
        });

        // Settings actions
        document.getElementById("btn-save-school-settings").addEventListener("click", () => this.saveSettings());
        document.getElementById("btn-load-demo-data").addEventListener("click", () => this.loadDemoData());
        document.getElementById("btn-clear-all-data").addEventListener("click", () => this.clearAllData());

        // Cloud DB actions
        document.getElementById("btn-save-db-url").addEventListener("click", () => {
            const url = document.getElementById("setting-db-url").value.trim();
            if (url) {
                localStorage.setItem("db_url", url);
                this.dbUrl = url;
                this.verifyCloudConnection(false);
            } else {
                localStorage.removeItem("db_url");
                this.dbUrl = null;
                this.updateCloudStatus("offline");
                alert("ยกเลิกการเชื่อมต่อคลาวด์แล้ว ระบบจะทำงานแบบออฟไลน์แยกเฉพาะคอมพิวเตอร์เครื่องนี้");
                this.loadProjects(); // Reload local projects list
                this.renderDashboard();
                this.renderProjectsList();
                this.populateMemoDropdowns();
            }
        });

        document.getElementById("btn-sync-now").addEventListener("click", () => {
            this.syncFromCloud();
        });

        // Project Modal controls
        document.getElementById("btn-add-project").addEventListener("click", () => this.openProjectModal());
        document.getElementById("btn-close-project-modal").addEventListener("click", () => this.closeProjectModal());
        document.getElementById("btn-cancel-project-modal").addEventListener("click", () => this.closeProjectModal());
        document.getElementById("btn-save-project").addEventListener("click", () => this.saveProjectForm());
        document.getElementById("btn-add-activity-row").addEventListener("click", () => this.addActivityRowToModal());
        document.getElementById("project-has-sub-field").addEventListener("change", function() {
            const container = document.getElementById("activities-manager-section");
            container.style.display = this.checked ? "block" : "none";
            self.calculateModalBudgets();
        });

        // Project budget input validation triggers
        document.getElementById("project-budget-field").addEventListener("input", () => this.calculateModalBudgets());

        // Memo Form controls and real-time preview updates
        document.getElementById("memo-project-select").addEventListener("change", function() {
            self.onMemoProjectChange(this.value);
        });
        document.getElementById("memo-activity-select").addEventListener("change", function() {
            self.onMemoActivityChange(this.value);
        });

        // Real-time input updates to preview
        const previewFields = [
            "memo-doc-no", "memo-doc-date", "memo-agency", "memo-subject", "memo-to",
            "memo-dept", "memo-page-no", "memo-prev-spent", // New input fields
            "memo-para1", "memo-para2", "memo-para3",
            "memo-owner-name", "memo-owner-pos",
            "memo-project-owner-name", "memo-project-owner-pos",
            "memo-approver-name", "memo-approver-pos"
        ];
        
        previewFields.forEach(fieldId => {
            document.getElementById(fieldId).addEventListener("input", () => this.updateMemoPreview());
        });

        // Expense item add trigger
        document.getElementById("btn-add-expense-item").addEventListener("click", () => {
            this.expenseItems.push({ name: "", amount: 0 });
            this.renderExpenseItemsBuilder();
            this.updateMemoPreview();
        });

        // Print triggers
        document.getElementById("btn-browser-print").addEventListener("click", () => {
            window.print();
        });
        document.getElementById("btn-download-pdf").addEventListener("click", () => this.downloadPDF());

        // Attachment upload event listener
        document.getElementById("memo-attachment-upload").addEventListener("change", (e) => this.handleAttachmentUpload(e));

        // Print project tab listeners
        const printProjSelect = document.getElementById("print-project-select");
        if (printProjSelect) {
            printProjSelect.addEventListener("change", (e) => this.onPrintProjectChange(e.target.value));
        }
        const btnPrintProj = document.getElementById("btn-print-project-pdf");
        if (btnPrintProj) {
            btnPrintProj.addEventListener("click", () => window.print());
        }
        const btnDownloadProj = document.getElementById("btn-download-project-pdf");
        if (btnDownloadProj) {
            btnDownloadProj.addEventListener("click", () => this.downloadPrintProjectPDF());
        }

        // Window resize event to auto scale A4 preview sheets
        window.addEventListener("resize", () => {
            this.adjustPreviewScale();
            this.adjustPrintPreviewScale();
        });
    },

    // ==========================================================================
    // Google Sheets Cloud Synchronization Methods
    // ==========================================================================
    updateCloudStatus: function(status) {
        const badge = document.getElementById("db-status-badge");
        const syncBtn = document.getElementById("btn-sync-now");

        if (status === "offline") {
            badge.className = "db-status-badge-offline";
            badge.textContent = "ปิดใช้งาน (ใช้ออฟไลน์เฉพาะในเครื่องนี้)";
            syncBtn.style.display = "none";
        } else if (status === "loading") {
            badge.className = "db-status-badge-loading";
            badge.textContent = "กำลังซิงค์และเชื่อมต่อระบบคลาวด์...";
        } else if (status === "online") {
            badge.className = "db-status-badge-online";
            badge.textContent = "เชื่อมต่อคลาวด์สำเร็จ (Google Sheets)";
            syncBtn.style.display = "inline-block";
        }
    },

    verifyCloudConnection: function(silent = false) {
        if (!this.dbUrl) return;
        
        this.updateCloudStatus("loading");

        fetch(this.dbUrl)
            .then(res => {
                if (!res.ok) throw new Error("HTTP error " + res.status);
                return res.json();
            })
            .then(res => {
                if (res.status === "success") {
                    this.projects = res.data || [];
                    localStorage.setItem("school_projects", JSON.stringify(this.projects));
                    this.updateCloudStatus("online");
                    
                    this.renderDashboard();
                    this.renderProjectsList();
                    this.populateMemoDropdowns();
                    this.updateMemoPreview();

                    if (!silent) {
                        alert("เชื่อมต่อฐานข้อมูลคลาวด์ Google Sheets เรียบร้อยแล้ว!\nระบบทำการดึงข้อมูลล่าสุดเรียบร้อย");
                    }
                } else {
                    throw new Error(res.message || "Unknown error");
                }
            })
            .catch(err => {
                this.updateCloudStatus("offline");
                if (!silent) {
                    alert("เชื่อมต่อคลาวด์ล้มเหลว!\nกรุณาตรวจสอบว่า:\n1. วาง URL แอดเดรสถูกต้อง\n2. ตั้งค่า Apps Script แบบ 'Anyone' (ทุกคนที่มีลิงก์) หรือยัง\n\nรายละเอียดข้อผิดพลาด: " + err.message);
                }
            });
    },

    syncToCloud: function() {
        if (!this.dbUrl) return;

        this.updateCloudStatus("loading");

        fetch(this.dbUrl, {
            method: "POST",
            mode: "cors",
            headers: {
                "Content-Type": "text/plain" // Simple request to bypass pre-flight CORS issues
            },
            body: JSON.stringify({
                action: "saveProjectsList",
                projects: this.projects
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                this.updateCloudStatus("online");
            } else {
                throw new Error(res.message);
            }
        })
        .catch(err => {
            console.error("Cloud push failed: ", err);
            this.updateCloudStatus("online"); // Fall back to online status label, but log warning
        });
    },

    syncFromCloud: function() {
        this.verifyCloudConnection(false);
    },

    // Load Demo Data (Requested scenario: 45,000 Baht, 4 Activities)
    loadDemoData: function() {
        const demo = [
            {
                id: "project-demo-1",
                name: "โครงการพัฒนาคุณภาพวิชาการ",
                totalBudget: 45000,
                owner: "นางสาวใจดี พัฒนา",
                projectDate: "1 พฤษภาคม 2569", // Locked project date
                projectPageNo: "52-55",
                hasSubActivities: true,
                activities: [
                    { id: "act-1", name: "กิจกรรมพัฒนาทักษะคณิตศาสตร์", budget: 10000, date: "15 กรกฎาคม 2569", owner: "นายสมชาย เรียนดี" },
                    { id: "act-2", name: "กิจกรรมค่ายวิทยาศาสตร์สร้างสรรค์", budget: 15000, date: "18 กรกฎาคม 2569", owner: "นางสาวสมศรี เก่งวิทย์" },
                    { id: "act-3", name: "กิจกรรมประกวดสุนทรพจน์ภาษาอังกฤษ", budget: 8000, date: "24 กรกฎาคม 2569", owner: "นายสมศักดิ์ รักอังกฤษ" },
                    { id: "act-4", name: "กิจกรรมอบรมเทคโนโลยีสารสนเทศสมัยใหม่", budget: 9000, date: "3 สิงหาคม 2569", owner: "นางสาวใจดี พัฒนา" }
                ]
            },
            {
                id: "project-demo-2",
                name: "โครงการจัดซื้อคอมพิวเตอร์และครุภัณฑ์ห้องเรียน (โครงการเดี่ยว)",
                totalBudget: 25000,
                owner: "นายประหยัด พอเพียง",
                projectDate: "10 พฤษภาคม 2569", // Locked project date
                projectPageNo: "80",
                hasSubActivities: false,
                activities: [
                    { id: "act-5", name: "โครงการจัดซื้อคอมพิวเตอร์และครุภัณฑ์ห้องเรียน", budget: 25000, date: "25 มิถุนายน 2569", owner: "นายประหยัด พอเพียง" }
                ]
            }
        ];
        
        this.projects = demo;
        this.saveProjects();
        alert("โหลดข้อมูลจำลองเข้าสู่ระบบแล้ว:\n- โครงการใหญ่ งบประมาณ 45,000 บาท (อนุมัติ 1 พ.ค. 2569) มี 4 กิจกรรมย่อย\n- โครงการเดี่ยว งบประมาณ 25,000 บาท (อนุมัติ 10 พ.ค. 2569) ไม่มีกิจกรรมย่อย\n*(หากเชื่อมต่อคลาวด์อยู่ ข้อมูลตัวอย่างจะถูกซิงค์ขึ้น Google Sheets ทันที)*");
        this.switchTab("dashboard");
    },

    // Clear all data
    clearAllData: function() {
        if (confirm("คุณแน่ใจหรือไม่ที่จะล้างข้อมูลทั้งหมดในระบบ? ข้อมูลโครงการและกิจกรรมที่เคยบันทึกไว้จะหายไปทั้งหมด!")) {
            this.projects = [];
            this.saveProjects();
            alert("ล้างข้อมูลในระบบเรียบร้อยแล้ว");
            this.switchTab("dashboard");
        }
    },

    // ==========================================================================
    // Dashboard Logic
    // ==========================================================================
    renderDashboard: function() {
        let totalBudget = 0;
        let totalAllocated = 0;
        let totalProjectsCount = this.projects.length;

        this.projects.forEach(p => {
            totalBudget += parseFloat(p.totalBudget || 0);
            if (p.hasSubActivities) {
                p.activities.forEach(a => {
                    totalAllocated += parseFloat(a.budget || 0);
                });
            } else {
                totalAllocated += parseFloat(p.totalBudget || 0);
            }
        });

        const totalRemaining = totalBudget - totalAllocated;
        const allocatedPercent = totalBudget > 0 ? Math.round((totalAllocated / totalBudget) * 100) : 0;
        const remainingPercent = totalBudget > 0 ? Math.round((totalRemaining / totalBudget) * 100) : 0;

        // Update indicators
        document.getElementById("dash-total-budget").textContent = this.formatCurrency(totalBudget) + " บาท";
        document.getElementById("dash-project-count").textContent = totalProjectsCount + " โครงการใหญ่";
        document.getElementById("dash-allocated-budget").textContent = this.formatCurrency(totalAllocated) + " บาท";
        document.getElementById("dash-allocated-percent").textContent = allocatedPercent + "% ของงบประมาณทั้งหมด";
        document.getElementById("dash-remaining-budget").textContent = this.formatCurrency(totalRemaining) + " บาท";
        document.getElementById("dash-remaining-percent").textContent = remainingPercent + "% ยังไม่ได้จัดสรร";

        // Render project summaries
        const listContainer = document.getElementById("dashboard-project-list");
        if (this.projects.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-folder-open empty-icon"></i>
                    <p>ไม่พบข้อมูลโครงการในระบบ กรุณาเพิ่มโครงการที่เมนู "จัดการโครงการ"</p>
                </div>
            `;
            return;
        }

        let html = "";
        this.projects.forEach(p => {
            let pAllocated = 0;
            if (p.hasSubActivities) {
                p.activities.forEach(a => { pAllocated += parseFloat(a.budget || 0); });
            } else {
                pAllocated = parseFloat(p.totalBudget || 0);
            }
            
            const pRemaining = p.totalBudget - pAllocated;
            const pPercent = p.totalBudget > 0 ? Math.min(100, Math.round((pAllocated / p.totalBudget) * 100)) : 0;
            const isExceeded = pAllocated > p.totalBudget;

            let activitiesHtml = "";
            if (p.hasSubActivities && p.activities && p.activities.length > 0) {
                p.activities.forEach(a => {
                    activitiesHtml += `
                        <span class="activity-pill">
                            <i class="fa-solid fa-tag"></i>
                            ${a.name}: <strong>${this.formatCurrency(a.budget)} บาท</strong> (${a.owner}) | 📅 ${a.date || '-'}
                        </span>
                    `;
                });
            } else {
                activitiesHtml = `<span class="activity-pill"><i class="fa-solid fa-circle"></i> โครงการเดี่ยว (ไม่มีกิจกรรมย่อย) | 📅 ${p.projectDate || '-'}</span>`;
            }

            html += `
                <div class="project-summary-item">
                    <div class="project-summary-info">
                        <span class="project-summary-name">${p.name} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary);">โดย ${p.owner} (อนุมัติ: ${p.projectDate || '-'} | แผนฯ หน้า: ${p.projectPageNo || '-'})</span></span>
                        <span class="project-summary-budget">${this.formatCurrency(p.totalBudget)} บาท</span>
                    </div>
                    <div class="progress-container">
                        <div class="progress-track">
                            <div class="progress-bar ${isExceeded ? 'exceeded' : ''}" style="width: ${pPercent}%"></div>
                        </div>
                    </div>
                    <div class="progress-stats">
                        <span>จัดสรรกิจกรรมแล้ว: ${this.formatCurrency(pAllocated)} บาท (${pPercent}%)</span>
                        <span class="${pRemaining < 0 ? 'text-danger' : (pRemaining === 0 ? 'text-success' : '')}" style="font-weight: 600;">
                            ${pRemaining < 0 ? 'งบประมาณทะลุโครงการ: ' : 'คงเหลือจัดสรร: '} ${this.formatCurrency(pRemaining)} บาท
                        </span>
                    </div>
                    <div class="project-summary-activities">
                        ${activitiesHtml}
                    </div>
                </div>
            `;
        });
        
        listContainer.innerHTML = html;
    },

    // ==========================================================================
    // Projects Management Logic
    // ==========================================================================
    renderProjectsList: function() {
        const container = document.getElementById("projects-container");
        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p>ยังไม่มีโครงการถูกบันทึกในระบบ กดปุ่ม "สร้างโครงการใหม่" เพื่อเริ่มต้น</p>
                </div>
            `;
            return;
        }

        let html = "";
        this.projects.forEach(p => {
            let pAllocated = 0;
            if (p.hasSubActivities) {
                p.activities.forEach(a => { pAllocated += parseFloat(a.budget || 0); });
            } else {
                pAllocated = parseFloat(p.totalBudget || 0);
            }
            
            const pRemaining = p.totalBudget - pAllocated;

            let activitiesRows = "";
            if (p.hasSubActivities && p.activities && p.activities.length > 0) {
                p.activities.forEach(a => {
                    activitiesRows += `
                        <div class="project-card-activity-item">
                            <span class="act-name" title="${a.name}">${a.name}</span>
                            <div style="text-align: right;">
                                <span class="act-budget">${this.formatCurrency(a.budget)} บาท</span>
                                <div style="font-size: 0.65rem; color: var(--text-secondary);"><i class="fa-solid fa-calendar"></i> ${a.date || '-'}</div>
                            </div>
                        </div>
                    `;
                });
            } else {
                activitiesRows = `
                    <div class="project-card-activity-item" style="font-style: italic; color: var(--text-secondary);">
                        <span>โครงการเดี่ยว (ไม่มีกิจกรรมย่อย)</span>
                        <span>📅 ${p.projectDate || '-'}</span>
                    </div>
                `;
            }

            let statusClass = "success";
            if (pRemaining < 0) statusClass = "danger";
            else if (pRemaining === 0) statusClass = "warning";

            html += `
                <div class="project-card">
                    <div>
                        <div class="project-card-header">
                            <div class="project-card-title">${p.name}</div>
                            <div class="project-card-actions">
                                <button class="btn-icon edit" onclick="app.openProjectModal('${p.id}')" title="แก้ไขโครงการ"><i class="fa-solid fa-pen-to-square"></i></button>
                                <button class="btn-icon delete" onclick="app.deleteProject('${p.id}')" title="ลบโครงการ"><i class="fa-solid fa-trash-can"></i></button>
                            </div>
                        </div>
                        <div class="project-card-owner" style="flex-wrap: wrap; gap: 0.5rem 0;">
                            <div><i class="fa-solid fa-user-tie"></i> ผู้รับผิดชอบ: ${p.owner}</div>
                            <div style="margin-left: auto; font-size: 0.75rem; color: var(--text-secondary);"><i class="fa-solid fa-calendar-check"></i> อนุมัติ: ${p.projectDate || '-'}</div>
                            <div style="width: 100%; font-size: 0.75rem; color: var(--primary-color); margin-top: 0.25rem;"><i class="fa-solid fa-book-open"></i> หน้าแผนปฏิบัติราชการ: ${p.projectPageNo || '-'}</div>
                        </div>
                        
                        <div class="project-card-budget-details">
                            <div class="budget-val-block">
                                <span class="budget-val-lbl">งบโครงการใหญ่:</span>
                                <span class="budget-val-num">${this.formatCurrency(p.totalBudget)} บาท</span>
                            </div>
                            <div class="budget-val-block">
                                <span class="budget-val-lbl">งบคงเหลือจัดสรร:</span>
                                <span class="budget-val-num ${statusClass}">${this.formatCurrency(pRemaining)} บาท</span>
                            </div>
                        </div>

                        <div class="project-card-activities-preview">
                            <div class="project-card-activities-title">กิจกรรมภายใต้โครงการ (${p.hasSubActivities ? p.activities.length : 1})</div>
                            <div class="project-card-activities-list">
                                ${activitiesRows}
                            </div>
                        </div>
                    </div>

                    <div class="project-card-footer-action">
                        <button class="btn btn-secondary btn-sm" style="width: 100%;" onclick="app.triggerMemoForProject('${p.id}')">
                            <i class="fa-solid fa-file-signature"></i> จัดทำบันทึกขออนุมัติ
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    deleteProject: function(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        if (confirm(`คุณต้องการลบโครงการ "${project.name}" และกิจกรรมย่อยทั้งหมดใช่หรือไม่? ข้อมูลนี้ไม่สามารถกู้คืนได้`)) {
            this.projects = this.projects.filter(p => p.id !== projectId);
            this.saveProjects();
        }
    },

    triggerMemoForProject: function(projectId) {
        this.switchTab("memo-creator");
        document.getElementById("memo-project-select").value = projectId;
        this.onMemoProjectChange(projectId);
    },

    // ==========================================================================
    // Project Modal Logic
    // ==========================================================================
    openProjectModal: function(projectId = null) {
        const modal = document.getElementById("modal-project");
        const title = document.getElementById("modal-project-title");
        const form = document.getElementById("project-form");
        
        form.reset();
        document.getElementById("modal-activities-body").innerHTML = "";
        
        if (projectId) {
            // Edit mode
            const project = this.projects.find(p => p.id === projectId);
            if (!project) return;
            
            title.textContent = "แก้ไขข้อมูลโครงการ";
            document.getElementById("project-id-field").value = project.id;
            document.getElementById("project-name-field").value = project.name;
            document.getElementById("project-budget-field").value = project.totalBudget;
            document.getElementById("project-owner-field").value = project.owner;
            document.getElementById("project-date-field").value = project.projectDate || ""; // Locked project date
            document.getElementById("project-page-field").value = project.projectPageNo || ""; // Load page number
            
            const linkField = document.getElementById("project-file-link-field");
            if (linkField) {
                linkField.value = project.projectFileId ? `https://drive.google.com/file/d/${project.projectFileId}/view` : "";
            }
            
            const hasSubCheckbox = document.getElementById("project-has-sub-field");
            hasSubCheckbox.checked = project.hasSubActivities;
            document.getElementById("activities-manager-section").style.display = project.hasSubActivities ? "block" : "none";

            if (project.hasSubActivities && project.activities) {
                project.activities.forEach(act => {
                    this.addActivityRowToModal(act.name, act.budget, act.date || "", act.owner, act.id);
                });
            }
        } else {
            // Create mode
            title.textContent = "สร้างโครงการใหม่";
            document.getElementById("project-id-field").value = "";
            document.getElementById("project-has-sub-field").checked = true;
            document.getElementById("activities-manager-section").style.display = "block";
            document.getElementById("project-page-field").value = ""; // Clear page number
            
            const linkField = document.getElementById("project-file-link-field");
            if (linkField) linkField.value = "";
            
            // Add one default activity row
            this.addActivityRowToModal();
        }

        this.calculateModalBudgets();
        modal.classList.add("active");
    },

    closeProjectModal: function() {
        document.getElementById("modal-project").classList.remove("active");
    },

    addActivityRowToModal: function(name = "", budget = "", date = "", owner = "", id = null) {
        const tbody = document.getElementById("modal-activities-body");
        const rowId = id || "act-row-" + Date.now() + Math.random().toString(36).substring(2, 5);
        
        const tr = document.createElement("tr");
        tr.className = "activity-editor-row";
        tr.setAttribute("data-row-id", rowId);
        
        tr.innerHTML = `
            <td>
                <input type="text" class="form-control act-name-input" value="${name}" placeholder="เช่น กิจกรรมค่ายวิชาการ..." required>
            </td>
            <td>
                <input type="number" class="form-control act-budget-input" value="${budget}" placeholder="เช่น 10000" min="0" required>
            </td>
            <td>
                <input type="text" class="form-control act-date-input" value="${date}" placeholder="เช่น 15 กรกฎาคม 2569" required>
            </td>
            <td>
                <input type="text" class="form-control act-owner-input" value="${owner}" placeholder="เช่น นายสมชาย เรียนดี" required>
            </td>
            <td>
                <button type="button" class="btn-icon delete" onclick="this.closest('tr').remove(); app.calculateModalBudgets();" title="ลบกิจกรรม"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        
        tbody.appendChild(tr);
        
        // Add event listeners to newly added inputs for real-time sum
        tr.querySelector(".act-budget-input").addEventListener("input", () => this.calculateModalBudgets());
    },

    calculateModalBudgets: function() {
        const totalBudget = parseFloat(document.getElementById("project-budget-field").value || 0);
        const hasSub = document.getElementById("project-has-sub-field").checked;
        const summaryBox = document.getElementById("modal-budget-summary");
        
        if (!hasSub) {
            summaryBox.style.display = "none";
            return;
        }
        
        summaryBox.style.display = "flex";
        
        let allocatedTotal = 0;
        document.querySelectorAll(".act-budget-input").forEach(input => {
            allocatedTotal += parseFloat(input.value || 0);
        });
        
        const remaining = totalBudget - allocatedTotal;
        
        document.getElementById("modal-allocated-total").textContent = this.formatCurrency(allocatedTotal);
        const remainingSpan = document.getElementById("modal-remaining-total");
        remainingSpan.textContent = this.formatCurrency(remaining);
        
        const statusDiv = document.getElementById("modal-remaining-status");
        if (remaining < 0) {
            summaryBox.classList.add("danger");
            statusDiv.innerHTML = `งบประมาณกิจกรรมเกินงบโครงการใหญ่: <span id="modal-remaining-total" style="color:#f87171;">${this.formatCurrency(remaining)}</span> บาท`;
        } else {
            summaryBox.classList.remove("danger");
            statusDiv.innerHTML = `งบประมาณโครงการใหญ่คงเหลือ: <span id="modal-remaining-total">${this.formatCurrency(remaining)}</span> บาท`;
        }
    },

    saveProjectForm: function() {
        const id = document.getElementById("project-id-field").value;
        const name = document.getElementById("project-name-field").value.trim();
        const totalBudget = parseFloat(document.getElementById("project-budget-field").value || 0);
        const owner = document.getElementById("project-owner-field").value.trim();
        const projectDate = document.getElementById("project-date-field").value.trim(); // Locked project date
        const projectPageNo = document.getElementById("project-page-field").value.trim();
        const hasSubActivities = document.getElementById("project-has-sub-field").checked;

        if (!name || isNaN(totalBudget) || !owner || !projectDate) {
            alert("กรุณากรอกข้อมูลโครงการหลักให้ครบถ้วน รวมถึงวันที่อนุมัติโครงการใหญ่");
            return;
        }

        let activities = [];
        if (hasSubActivities) {
            const rows = document.querySelectorAll(".activity-editor-row");
            let isValid = true;
            
            rows.forEach(row => {
                const actName = row.querySelector(".act-name-input").value.trim();
                const actBudget = parseFloat(row.querySelector(".act-budget-input").value || 0);
                const actDate = row.querySelector(".act-date-input").value.trim(); // Specific activity date
                const actOwner = row.querySelector(".act-owner-input").value.trim();
                const actId = row.getAttribute("data-row-id");
                
                if (!actName || isNaN(actBudget) || !actDate || !actOwner) {
                    isValid = false;
                    return;
                }
                
                activities.push({
                    id: actId,
                    name: actName,
                    budget: actBudget,
                    date: actDate,
                    owner: actOwner
                });
            });

            if (!isValid || activities.length === 0) {
                alert("กรุณากรอกข้อมูลกิจกรรมย่อยให้ครบถ้วนทุกรายการ (หรือลบแถวที่ไม่จำเป็นออก)");
                return;
            }

            // Budget validation check
            let allocatedSum = activities.reduce((sum, act) => sum + act.budget, 0);
            if (allocatedSum > totalBudget) {
                if (!confirm("คำเตือน: ยอดรวมของกิจกรรมย่อย สูงกว่างบประมาณโครงการใหญ่ที่ได้รับ คุณต้องการบันทึกข้อมูลอยู่หรือไม่?")) {
                    return;
                }
            }
        } else {
            // For a single project, create 1 implicit sub-activity matching the project details
            activities.push({
                id: "act-single-" + (id || Date.now()),
                name: name,
                budget: totalBudget,
                date: projectDate, // Uses the locked project date as default
                owner: owner
            });
        }

        const linkVal = document.getElementById("project-file-link-field") ? document.getElementById("project-file-link-field").value.trim() : "";
        let fileId = "";
        if (linkVal) {
            const match = linkVal.match(/\/d\/([a-zA-Z0-9-_]+)/) || linkVal.match(/id=([a-zA-Z0-9-_]+)/);
            fileId = match ? match[1] : linkVal;
        }

        const projectData = {
            id: id || "project-" + Date.now(),
            name: name,
            totalBudget: totalBudget,
            owner: owner,
            projectDate: projectDate,
            projectPageNo: projectPageNo,
            hasSubActivities: hasSubActivities,
            projectFileId: fileId,
            activities: activities
        };

        if (id) {
            // Edit existing
            this.projects = this.projects.map(p => p.id === id ? projectData : p);
        } else {
            // Add new
            this.projects.push(projectData);
        }

        this.saveProjects();
        this.closeProjectModal();
    },

    // ==========================================================================
    // Memo Creator Logic
    // ==========================================================================
    populateMemoDropdowns: function() {
        const projectSelect = document.getElementById("memo-project-select");
        const currentVal = projectSelect.value;
        
        projectSelect.innerHTML = `<option value="">-- เลือกโครงการ --</option>`;
        this.projects.forEach(p => {
            projectSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });

        if (currentVal && this.projects.some(p => p.id === currentVal)) {
            projectSelect.value = currentVal;
        } else {
            document.getElementById("memo-activity-select").innerHTML = `<option value="">-- เลือกกิจกรรมย่อย --</option>`;
            document.getElementById("memo-activity-select").disabled = true;
            document.getElementById("memo-budget-info").style.display = "none";
        }
    },

    onMemoProjectChange: function(projectId) {
        const activitySelect = document.getElementById("memo-activity-select");
        const activityGroup = document.getElementById("memo-activity-select-group");
        const budgetInfo = document.getElementById("memo-budget-info");

        if (!projectId) {
            activitySelect.innerHTML = `<option value="">-- เลือกกิจกรรมย่อย --</option>`;
            activitySelect.disabled = true;
            budgetInfo.style.display = "none";
            this.cachedCloudFileId = null;
            this.cachedCloudFileData = null;
            this.renderAttachmentPreviews();
            return;
        }

        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        // Auto-fill project page number
        if (project.projectPageNo) {
            document.getElementById("memo-page-no").value = project.projectPageNo;
        } else {
            document.getElementById("memo-page-no").value = "";
        }

        this.cachedCloudFileId = null;
        this.cachedCloudFileData = null;
        this.renderAttachmentPreviews();

        // Auto-fill project owner to co-signer block in form
        document.getElementById("memo-project-owner-name").value = project.owner;
        
        if (project.hasSubActivities) {
            activityGroup.style.display = "block";
            activitySelect.disabled = false;
            activitySelect.innerHTML = `<option value="">-- เลือกกิจกรรมย่อย --</option>`;
            
            project.activities.forEach(a => {
                activitySelect.innerHTML += `<option value="${a.id}">${a.name}</option>`;
            });
            
            budgetInfo.style.display = "none";
            
            // Clear activity values in preview
            document.getElementById("preview-owner-name").textContent = "-";
            document.getElementById("preview-owner-pos").textContent = "ครู โรงเรียนวัดบ้านดาบ";
        } else {
            // If single project, it only has 1 activity which is the project itself
            activityGroup.style.display = "none"; // Hide selection since there's only 1
            const singleAct = project.activities[0];
            
            // Render budget details
            budgetInfo.style.display = "flex";
            document.getElementById("memo-project-budget-val").textContent = this.formatCurrency(project.totalBudget) + " บาท";
            document.getElementById("memo-activity-budget-val").textContent = this.formatCurrency(project.totalBudget) + " บาท";
            document.getElementById("memo-project-remaining-val").textContent = "0 บาท";
            
            // Auto fill form fields
            document.getElementById("memo-owner-name").value = singleAct.owner;
            // Prefill subject exactly from Image 2 template
            document.getElementById("memo-subject").value = "ขออนุญาตดำเนินการตามกิจกรรมในแผนปฏิบัติราชการประจำปี";
            
            this.generateDefaultParagraphs(project.name, project.totalBudget, singleAct.owner, project.name, project.projectDate, singleAct.date || project.projectDate);
            this.updateMemoPreview();
        }
    },

    onMemoActivityChange: function(activityId) {
        const projectId = document.getElementById("memo-project-select").value;
        const budgetInfo = document.getElementById("memo-budget-info");
        
        if (!projectId || !activityId) {
            budgetInfo.style.display = "none";
            return;
        }

        const project = this.projects.find(p => p.id === projectId);
        const activity = project.activities.find(a => a.id === activityId);
        
        if (!project || !activity) return;

        // Calculate project budgets
        let allocatedTotal = 0;
        project.activities.forEach(a => { allocatedTotal += parseFloat(a.budget || 0); });
        const remaining = project.totalBudget - allocatedTotal;

        budgetInfo.style.display = "flex";
        document.getElementById("memo-project-budget-val").textContent = this.formatCurrency(project.totalBudget) + " บาท";
        document.getElementById("memo-activity-budget-val").textContent = this.formatCurrency(activity.budget) + " บาท";
        document.getElementById("memo-project-remaining-val").textContent = this.formatCurrency(remaining) + " บาท";
        
        // Auto fill form fields
        document.getElementById("memo-owner-name").value = activity.owner;
        // Prefill subject exactly from Image 2 template
        document.getElementById("memo-subject").value = "ขออนุญาตดำเนินการตามกิจกรรมในแผนปฏิบัติราชการประจำปี";

        this.generateDefaultParagraphs(activity.name, activity.budget, activity.owner, project.name, project.projectDate, activity.date);
        this.updateMemoPreview();
    },

    generateDefaultParagraphs: function(activityName, budgetAmount, ownerName, projectName, projectDate, activityDate) {
        const dept = document.getElementById("memo-dept").value.trim() || "กลุ่มงานบริหารงานวิชาการ";
        const pageNo = document.getElementById("memo-page-no").value.trim() || "1";
        const prevSpent = parseFloat(document.getElementById("memo-prev-spent").value || 0);
        
        let currentRequest = 0;
        this.expenseItems.forEach(item => {
            currentRequest += parseFloat(item.amount || 0);
        });
        
        const remaining = budgetAmount - prevSpent - currentRequest;
        
        // Locked Project Date and Specific Activity Date are used dynamically here!
        const p1 = `ด้วย (${dept}) จะดำเนินการจัดกิจกรรม "${activityName}" ตามโครงการ/งาน "${projectName}" หน้า ${pageNo} จะดำเนินการวันที่ ${activityDate || '-'} ได้รับงบประมาณจำนวนเงิน ${this.formatCurrency(budgetAmount)} บาท ขอเบิกแล้ว ${this.formatCurrency(prevSpent)} บาท และขออนุมัติงบประมาณในครั้งนี้ จำนวนเงิน ${this.formatCurrency(currentRequest)} บาท คงเหลือ ${this.formatCurrency(remaining)} บาท`;
        const p2 = `จึงเรียนมาเพื่อโปรดพิจารณาตามรายการขอเบิกด้านล่างนี้`;
        
        document.getElementById("memo-para1").value = p1;
        document.getElementById("memo-para2").value = p2;
        
        // Setup initial default expense item matching the full budget minus previous spent
        const defaultItemAmount = budgetAmount - prevSpent;
        this.expenseItems = [
            { name: `งบประมาณดำเนินกิจกรรม ${activityName}`, amount: defaultItemAmount > 0 ? defaultItemAmount : 0 }
        ];
        
        this.renderExpenseItemsBuilder();
    },

    addDefaultExpenseRowIfEmpty: function() {
        if (this.expenseItems.length === 0) {
            this.expenseItems = [{ name: "ค่าวัสดุและอุปกรณ์ดำเนินงานกิจกรรม", amount: 1000 }];
        }
        this.renderExpenseItemsBuilder();
    },

    renderExpenseItemsBuilder: function() {
        const tbody = document.getElementById("expense-items-body");
        tbody.innerHTML = "";

        this.expenseItems.forEach((item, index) => {
            const tr = document.createElement("tr");
            tr.className = "expense-row";
            tr.innerHTML = `
                <td>
                    <input type="text" class="exp-name-input" value="${item.name}" placeholder="เช่น ค่าวัสดุเครื่องเขียน" data-index="${index}">
                </td>
                <td>
                    <input type="number" class="exp-amount-input" value="${item.amount}" placeholder="เช่น 2000" data-index="${index}" min="0">
                </td>
                <td>
                    <button class="btn-icon delete" type="button" onclick="app.deleteExpenseItem(${index})"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Add event listeners for dynamic typing in building block
        document.querySelectorAll(".exp-name-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const idx = parseInt(e.target.getAttribute("data-index"));
                this.expenseItems[idx].name = e.target.value;
                this.updateMemoPreview();
            });
        });

        document.querySelectorAll(".exp-amount-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const idx = parseInt(e.target.getAttribute("data-index"));
                this.expenseItems[idx].amount = parseFloat(e.target.value || 0);
                this.updateMemoPreview();
            });
        });

        this.calculateExpenseTotals();
    },

    deleteExpenseItem: function(index) {
        this.expenseItems.splice(index, 1);
        this.renderExpenseItemsBuilder();
        this.updateMemoPreview();
    },

    calculateExpenseTotals: function() {
        let total = 0;
        this.expenseItems.forEach(item => {
            total += parseFloat(item.amount || 0);
        });

        document.getElementById("expense-total-display").textContent = this.formatCurrency(total);
        
        // Validate against activity budget
        const projectId = document.getElementById("memo-project-select").value;
        const activityId = document.getElementById("memo-activity-select").value;
        const warning = document.getElementById("expense-warning");
        
        if (projectId) {
            const project = this.projects.find(p => p.id === projectId);
            let limitBudget = project.totalBudget;
            
            if (project.hasSubActivities && activityId) {
                const activity = project.activities.find(a => a.id === activityId);
                if (activity) limitBudget = activity.budget;
            }
            
            if (total > limitBudget) {
                warning.style.display = "block";
            } else {
                warning.style.display = "none";
            }
        } else {
            warning.style.display = "none";
        }

        return total;
    },

    // ==========================================================================
    // Custom Document Attachment Upload Handling (PDF/Images)
    // ==========================================================================
    handleAttachmentUpload: function(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        let loadedCount = 0;
        files.forEach(file => {
            const reader = new FileReader();
            if (file.type === "application/pdf") {
                reader.onload = (ev) => {
                    this.attachedFiles.push({
                        name: file.name,
                        type: "pdf",
                        data: ev.target.result // ArrayBuffer
                    });
                    loadedCount++;
                    if (loadedCount === files.length) {
                        this.renderAttachmentPreviews();
                    }
                };
                reader.readAsArrayBuffer(file);
            } else if (file.type.startsWith("image/")) {
                reader.onload = (ev) => {
                    this.attachedFiles.push({
                        name: file.name,
                        type: "image",
                        data: ev.target.result // Data URL
                    });
                    loadedCount++;
                    if (loadedCount === files.length) {
                        this.renderAttachmentPreviews();
                    }
                };
                reader.readAsDataURL(file);
            } else {
                alert(`ไม่รองรับไฟล์ประเภท ${file.name} (กรุณาใช้ไฟล์ PDF หรือรูปภาพเท่านั้น)`);
                loadedCount++;
                if (loadedCount === files.length) {
                    this.renderAttachmentPreviews();
                }
            }
        });
        
        // Clear input value to allow uploading same file again
        e.target.value = "";
    },

    deleteAttachment: function(index) {
        this.attachedFiles.splice(index, 1);
        this.renderAttachmentPreviews();
    },

    fetchCloudProjectFile: function(fileId) {
        if (!fileId || !this.dbUrl) return;
        
        // If already cached and match current ID, don't refetch
        if (this.cachedCloudFileId === fileId && this.cachedCloudFileData) {
            this.renderAttachmentPreviews();
            return;
        }
        
        const loadingIndicator = document.getElementById("cloud-file-loading");
        if (loadingIndicator) loadingIndicator.style.display = "flex";
        
        this.cachedCloudFileId = fileId;
        this.cachedCloudFileData = null;
        
        fetch(this.dbUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify({
                action: "getProjectFile",
                fileId: fileId
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                const base64Data = res.data;
                const mimeType = res.mimeType;
                const name = res.name;
                
                if (mimeType === "application/pdf") {
                    const binaryString = window.atob(base64Data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    this.cachedCloudFileData = {
                        name: name,
                        type: "pdf",
                        data: bytes.buffer
                    };
                } else {
                    this.cachedCloudFileData = {
                        name: name,
                        type: "image",
                        data: `data:${mimeType};base64,${base64Data}`
                    };
                }
                
                if (loadingIndicator) loadingIndicator.style.display = "none";
                this.renderAttachmentPreviews();
            } else {
                throw new Error(res.message);
            }
        })
        .catch(err => {
            console.error("Error fetching cloud project file: ", err);
            if (loadingIndicator) loadingIndicator.style.display = "none";
            alert("ไม่สามารถดึงไฟล์โครงการเต็มจาก Google Drive ได้: " + err.toString());
        });
    },

    renderAttachmentPreviews: function() {
        // Render attachment list in editor sidebar
        const listContainer = document.getElementById("memo-attachment-list");
        if (listContainer) {
            listContainer.innerHTML = "";
            this.attachedFiles.forEach((file, index) => {
                const item = document.createElement("div");
                item.className = "attachment-item";
                item.innerHTML = `
                    <span class="attachment-item-name">
                        <i class="${file.type === 'pdf' ? 'fa-solid fa-file-pdf' : 'fa-solid fa-file-image'}" style="color: ${file.type === 'pdf' ? '#ef4444' : '#3b82f6'};"></i>
                        ${file.name}
                    </span>
                    <button type="button" class="attachment-item-delete" onclick="app.deleteAttachment(${index})">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                listContainer.appendChild(item);
            });
        }

        // Render attachment pages in A4 print area
        const container = document.getElementById("attached-documents-container");
        if (!container) return;
        container.innerHTML = "";

        let filesToRender = [...this.attachedFiles];

        if (filesToRender.length === 0) {
            this.adjustPreviewScale();
            return;
        }

        // Initialize PDFjs worker if not set
        if (typeof pdfjsLib !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
        }

        let renderChainPromise = Promise.resolve();

        filesToRender.forEach((file) => {
            if (file.type === "image") {
                renderChainPromise = renderChainPromise.then(() => {
                    const pageBreak = document.createElement("div");
                    pageBreak.className = "page-break";
                    
                    const pageDiv = document.createElement("div");
                    pageDiv.className = "memo-attached-page";
                    
                    const img = document.createElement("img");
                    img.src = file.data;
                    
                    pageDiv.appendChild(img);
                    container.appendChild(pageBreak);
                    container.appendChild(pageDiv);
                });
            } else if (file.type === "pdf") {
                renderChainPromise = renderChainPromise.then(() => {
                    if (typeof pdfjsLib === "undefined") {
                        console.error("PDF.js library is not loaded.");
                        return;
                    }
                    const typedarray = new Uint8Array(file.data);
                    return pdfjsLib.getDocument({ data: typedarray }).promise.then((pdf) => {
                        let pagePromise = Promise.resolve();
                        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                            const num = pageNum;
                            pagePromise = pagePromise.then(() => {
                                return pdf.getPage(num).then((page) => {
                                    const viewport = page.getViewport({ scale: 2.0 }); // High-res render for crisp text
                                    const canvas = document.createElement("canvas");
                                    const context = canvas.getContext("2d");
                                    canvas.height = viewport.height;
                                    canvas.width = viewport.width;
                                    
                                    const renderContext = {
                                        canvasContext: context,
                                        viewport: viewport
                                    };
                                    
                                    return page.render(renderContext).promise.then(() => {
                                        const pageBreak = document.createElement("div");
                                        pageBreak.className = "page-break";
                                        
                                        const pageDiv = document.createElement("div");
                                        pageDiv.className = "memo-attached-page";
                                        
                                        pageDiv.appendChild(canvas);
                                        container.appendChild(pageBreak);
                                        container.appendChild(pageDiv);
                                    });
                                });
                            });
                        }
                        return pagePromise;
                    }).catch(err => {
                        console.error("Error rendering PDF attachment: ", err);
                    });
                });
            }
        });

        renderChainPromise.then(() => {
            // Once all renders are complete, update scaling
            setTimeout(() => this.adjustPreviewScale(), 150);
        });
    },

    // ==========================================================================
    // Update Document Live Preview
    // ==========================================================================
    updateMemoPreview: function() {
        // Read form values
        const docNo = document.getElementById("memo-doc-no").value.trim() || "-";
        const docDate = document.getElementById("memo-doc-date").value.trim() || "-";
        const agency = document.getElementById("memo-agency").value.trim() || "-";
        const subject = document.getElementById("memo-subject").value.trim() || "-";
        const to = document.getElementById("memo-to").value.trim() || "-";
        
        const ownerName = document.getElementById("memo-owner-name").value.trim() || "-";
        const ownerPos = document.getElementById("memo-owner-pos").value.trim() || "-";
        
        const projectOwnerName = document.getElementById("memo-project-owner-name").value.trim();
        const projectOwnerPos = document.getElementById("memo-project-owner-pos").value.trim() || "หัวหน้าโครงการ";
        
        const approverName = document.getElementById("memo-approver-name").value.trim() || "-";
        const approverPos = document.getElementById("memo-approver-pos").value.trim() || "-";

        // Read specific plan/budget values
        const dept = document.getElementById("memo-dept").value.trim() || "(ระบุฝ่าย/กลุ่ม/งาน)";
        const pageNo = document.getElementById("memo-page-no").value.trim() || "...";
        const prevSpent = parseFloat(document.getElementById("memo-prev-spent").value || 0);

        // Fetch activity/project details
        const projectId = document.getElementById("memo-project-select").value;
        const activityId = document.getElementById("memo-activity-select").value;
        
        let projectName = "-";
        let activityName = "-";
        let activityDate = "-";
        let budgetAmount = 0;
        
        let project = null;
        if (projectId) {
            project = this.projects.find(p => p.id === projectId);
            if (project) {
                projectName = project.name;
                activityName = project.name;
                activityDate = project.projectDate;
                budgetAmount = project.totalBudget;
                
                if (project.hasSubActivities && activityId) {
                    const activity = project.activities.find(a => a.id === activityId);
                    if (activity) {
                        activityName = activity.name;
                        activityDate = activity.date;
                        budgetAmount = activity.budget;
                    }
                }
            }
        }

        // Sum current request items
        let currentRequest = 0;
        this.expenseItems.forEach(item => {
            currentRequest += parseFloat(item.amount || 0);
        });

        // Compute remaining balance
        const remaining = budgetAmount - prevSpent - currentRequest;

        // Auto-compile formal administrative template paragraphs (Image 2 style)
        const p1 = `ด้วย (${dept}) จะดำเนินการจัดกิจกรรม "${activityName}" ตามโครงการ/งาน "${projectName}" หน้า ${pageNo} จะดำเนินการวันที่ ${activityDate} ได้รับงบประมาณจำนวนเงิน ${this.formatCurrency(budgetAmount)} บาท ขอเบิกแล้ว ${this.formatCurrency(prevSpent)} บาท และขออนุมัติงบประมาณในครั้งนี้ จำนวนเงิน ${this.formatCurrency(currentRequest)} บาท คงเหลือ ${this.formatCurrency(remaining)} บาท`;
        const p2 = `จึงเรียนมาเพื่อโปรดพิจารณาตามรายการขอเบิกด้านล่างนี้`;

        // Update disabled textarea controls in form
        document.getElementById("memo-para1").value = p1;
        document.getElementById("memo-para2").value = p2;

        // Bind metadata to A4 preview page
        document.getElementById("preview-doc-no").textContent = this.toThaiNumerals(docNo);
        document.getElementById("preview-doc-date").textContent = this.toThaiNumerals(docDate);
        document.getElementById("preview-agency").textContent = this.toThaiNumerals(agency);
        document.getElementById("preview-subject").textContent = this.toThaiNumerals(subject);
        document.getElementById("preview-to").textContent = this.toThaiNumerals(to);
        
        // Bind compiled paragraphs to A4 preview page
        document.getElementById("preview-para1").textContent = this.toThaiNumerals(p1);
        document.getElementById("preview-para2").textContent = this.toThaiNumerals(p2);
        
        // Bind static suffix paragraph
        const para3 = document.getElementById("memo-para3").value.trim();
        document.getElementById("preview-para3").textContent = this.toThaiNumerals(para3);
        
        // Bind signatures
        document.getElementById("preview-owner-name").textContent = this.toThaiNumerals(ownerName);
        document.getElementById("preview-owner-pos").textContent = this.toThaiNumerals(ownerPos);
        document.getElementById("preview-approver-name").textContent = this.toThaiNumerals(approverName);
        document.getElementById("preview-approver-pos").textContent = this.toThaiNumerals(approverPos);

        // Co-signature check
        const projectOwnerBlock = document.getElementById("preview-project-owner-block");
        if (project && project.hasSubActivities && projectOwnerName) {
            projectOwnerBlock.style.display = "flex";
            document.getElementById("preview-project-owner-name").textContent = this.toThaiNumerals(projectOwnerName);
            document.getElementById("preview-project-owner-pos").textContent = this.toThaiNumerals(projectOwnerPos);
        } else {
            projectOwnerBlock.style.display = "none";
        }

        // Render table of expense items
        const previewTableBody = document.getElementById("preview-table-body");
        const tableContainer = document.getElementById("preview-budget-table-container");
        
        if (this.expenseItems.length === 0) {
            tableContainer.style.display = "none";
        } else {
            tableContainer.style.display = "block";
            let rowsHtml = "";
            
            this.expenseItems.forEach((item, index) => {
                rowsHtml += `
                    <tr>
                        <td style="text-align: center;">${this.toThaiNumerals(index + 1)}</td>
                        <td style="text-align: left;">${item.name || "ยังไม่ระบุชื่อรายการ"}</td>
                        <td style="text-align: right;">${this.toThaiNumerals(this.formatCurrency(item.amount))}</td>
                    </tr>
                `;
            });
            
            previewTableBody.innerHTML = rowsHtml;
            document.getElementById("preview-total-amount").textContent = this.toThaiNumerals(this.formatCurrency(currentRequest));
            document.getElementById("preview-total-text").textContent = `(ตัวอักษร: ${this.arabicToThaiBaht(currentRequest)})`;
        }
        
        // Dynamic scale preview sheet to fit container width
        // Render Attachment Sheet (รายละเอียดโครงการและกิจกรรมแนบท้าย)
        const attachSheet = document.getElementById("preview-attachment-sheet");
        if (project) {
            attachSheet.style.display = "block";
            
            // Populate meta details in attachment header
            document.getElementById("attach-doc-no").textContent = this.toThaiNumerals(docNo);
            document.getElementById("attach-doc-date").textContent = this.toThaiNumerals(docDate);
            
            // Populate section 1: Main Project Details
            document.getElementById("attach-project-name").textContent = this.toThaiNumerals(project.name || "-");
            document.getElementById("attach-project-budget").textContent = this.toThaiNumerals(this.formatCurrency(project.totalBudget) + " บาท");
            document.getElementById("attach-project-owner").textContent = this.toThaiNumerals(project.owner || "-");
            document.getElementById("attach-project-date").textContent = this.toThaiNumerals(project.projectDate || "-");
            
            // Populate section 2: Current Sub-Activity Details
            document.getElementById("attach-act-name").textContent = this.toThaiNumerals(activityName || "-");
            document.getElementById("attach-act-budget").textContent = this.toThaiNumerals(this.formatCurrency(budgetAmount) + " บาท");
            document.getElementById("attach-act-owner").textContent = this.toThaiNumerals(ownerName || "-");
            document.getElementById("attach-act-date").textContent = this.toThaiNumerals(activityDate || "-");
            
            // Populate section 3: Summary table of all activities
            const attachTableBody = document.getElementById("attach-activities-table-body");
            if (attachTableBody) {
                let attachRowsHtml = "";
                if (project.activities && project.activities.length > 0) {
                    project.activities.forEach((act, index) => {
                        const isCurrent = (project.hasSubActivities && act.id === activityId) || (!project.hasSubActivities && index === 0);
                        const rowStyle = isCurrent ? "font-weight: bold; background-color: #f8fafc;" : "";
                        attachRowsHtml += `
                            <tr style="${rowStyle}">
                                <td style="text-align: center;">${this.toThaiNumerals(index + 1)}</td>
                                <td style="text-align: left;">${act.name || "-"} ${isCurrent ? " (กิจกรรมที่เสนออนุมัติครั้งนี้)" : ""}</td>
                                <td style="text-align: right;">${this.toThaiNumerals(this.formatCurrency(act.budget))}</td>
                                <td style="text-align: left;">${act.owner || "-"}</td>
                            </tr>
                        `;
                    });
                } else {
                    // No sub-activities, show the main project as the single row
                    attachRowsHtml += `
                        <tr style="font-weight: bold; background-color: #f8fafc;">
                            <td style="text-align: center;">${this.toThaiNumerals(1)}</td>
                            <td style="text-align: left;">${project.name} (ดำเนินงานเต็มโครงการ)</td>
                            <td style="text-align: right;">${this.toThaiNumerals(this.formatCurrency(project.totalBudget))}</td>
                            <td style="text-align: left;">${project.owner}</td>
                        </tr>
                    `;
                }
                attachTableBody.innerHTML = attachRowsHtml;
            }
        } else {
            attachSheet.style.display = "none";
        }

        this.adjustPreviewScale();
    },

    // ==========================================================================
    // PDF Generation via html2pdf
    // ==========================================================================
    downloadPDF: function() {
        const element = document.getElementById("print-pdf-root");
        const docDate = document.getElementById("memo-doc-date").value.trim() || "บันทึกข้อความ";
        const subject = document.getElementById("memo-subject").value.trim() || "ขออนุมัติจัดกิจกรรม";
        
        const opt = {
            margin: 0,
            filename: `บันทึกข้อความ_${subject.substring(0,25)}_${docDate}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2.5, useCORS: true, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };

        // Temporarily add class to body to hide page break markers in PDF
        document.body.classList.add("generating-pdf");

        // Temporarily reset inline scale transform and height for PDF generation
        const oldTransform = element.style.transform;
        const oldWidth = element.style.width;
        const oldHeight = element.style.height;
        const oldTransformOrigin = element.style.transformOrigin;
        
        element.style.transform = "none";
        element.style.width = "210mm";
        element.style.height = "auto";
        element.style.transformOrigin = "top left";

        html2pdf().set(opt).from(element).save().then(() => {
            // Restore styles
            document.body.classList.remove("generating-pdf");
            element.style.transform = oldTransform;
            element.style.width = oldWidth;
            element.style.height = oldHeight;
            element.style.transformOrigin = oldTransformOrigin;
        }).catch(err => {
            console.error("PDF generation error: ", err);
            document.body.classList.remove("generating-pdf");
            element.style.transform = oldTransform;
            element.style.width = oldWidth;
            element.style.height = oldHeight;
            element.style.transformOrigin = oldTransformOrigin;
        });
    },

    // Scale preview sheet using CSS transform to fit screen width
    adjustPreviewScale: function() {
        if (this.currentTab !== "memo-creator") return;
        
        const scrollContainer = document.querySelector(".memo-paper-scroll");
        const wrapper = document.querySelector(".memo-paper-scale-wrapper");
        const paper = document.getElementById("memo-paper-content");
        
        if (!scrollContainer || !wrapper || !paper) return;
        
        // Reset scale wrapper height first
        wrapper.style.height = "auto";
        
        const containerWidth = scrollContainer.clientWidth - 48; // padding offset (24px left + 24px right)
        const paperWidth = paper.offsetWidth; // width of the A4 paper (approx 794px)
        
        if (containerWidth < paperWidth && containerWidth > 0) {
            const scale = containerWidth / paperWidth;
            wrapper.style.transform = `scale(${scale})`;
            wrapper.style.transformOrigin = "top center";
            
            // Adjust height of the wrapper to match the scaled paper
            const paperHeight = paper.offsetHeight;
            wrapper.style.height = `${paperHeight * scale}px`;
        } else {
            wrapper.style.transform = "none";
            wrapper.style.height = "auto";
        }
    },

    // ==========================================================================
    // Helper Utilities
    // ==========================================================================
    formatCurrency: function(num) {
        return parseFloat(num).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    // Arabic numbers to Thai Baht text reader algorithm (e.g. 45000 -> สี่หมื่นห้าพันบาทถ้วน)
    arabicToThaiBaht: function(num) {
        if (num === null || num === undefined || isNaN(num)) return "-";
        num = parseFloat(num).toFixed(2);
        let [integerPart, decimalPart] = num.split('.');
        
        const THAI_NUMBERS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
        const THAI_UNITS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
        
        function convertSection(numberStr) {
            let text = "";
            let len = numberStr.length;
            for (let i = 0; i < len; i++) {
                let digit = parseInt(numberStr.charAt(i));
                let position = len - 1 - i;
                
                if (digit !== 0) {
                    // Handle 'เอ็ด' (1 in unit position for numbers > 10)
                    if (position === 0 && digit === 1 && len > 1) {
                        text += "เอ็ด";
                    }
                    // Handle 'ยี่' (2 in tens position)
                    else if (position === 1 && digit === 2) {
                        text += "ยี่";
                    }
                    // Handle 'เอ็ด' or skipping 'หนึ่ง' in tens position
                    else if (position === 1 && digit === 1) {
                        // text += ""; just skip 'หนึ่ง'
                    }
                    else {
                        text += THAI_NUMBERS[digit];
                    }
                    
                    text += THAI_UNITS[position % 6];
                }
                
                // Handle million unit wrap
                if (position > 0 && position % 6 === 0) {
                    text += "ล้าน";
                }
            }
            return text;
        }
        
        let bahtText = "";
        if (parseInt(integerPart) === 0) {
            bahtText += "ศูนย์บาท";
        } else {
            let integerVal = parseInt(integerPart);
            if (integerVal > 1000000) {
                let parts = [];
                let str = integerPart;
                while (str.length > 6) {
                    parts.unshift(str.slice(-6));
                    str = str.slice(0, -6);
                }
                parts.unshift(str);
                
                bahtText += convertSection(parts[0]) + "ล้าน";
                for (let i = 1; i < parts.length; i++) {
                    bahtText += convertSection(parts[i]);
                    if (i < parts.length - 1) bahtText += "ล้าน";
                }
                bahtText += "บาท";
            } else {
                bahtText += convertSection(integerPart) + "บาท";
            }
        }
        
        if (parseInt(decimalPart) === 0 || decimalPart === "00") {
            bahtText += "ถ้วน";
        } else {
            bahtText += convertSection(decimalPart) + "สตางค์";
        }
        
        return bahtText;
    },

    // ==========================================================================
    // Print Project Attachment Separately Tab Methods
    // ==========================================================================
    populatePrintProjectDropdown: function() {
        const select = document.getElementById("print-project-select");
        if (!select) return;
        
        const currentVal = select.value;
        select.innerHTML = `<option value="">-- เลือกโครงการ --</option>`;
        
        this.projects.forEach(p => {
            if (p.projectFileId) {
                select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
            }
        });
        
        if (currentVal && this.projects.some(p => p.id === currentVal && p.projectFileId)) {
            select.value = currentVal;
        } else {
            this.onPrintProjectChange("");
        }
    },

    onPrintProjectChange: function(projectId) {
        const detailsEl = document.getElementById("print-project-details");
        const btnPrint = document.getElementById("btn-print-project-pdf");
        const btnDownload = document.getElementById("btn-download-project-pdf");
        const renderContainer = document.getElementById("project-pdf-render-container");
        const filenameSpan = document.getElementById("print-project-filename");
        
        if (!projectId) {
            if (detailsEl) detailsEl.style.display = "none";
            if (btnPrint) btnPrint.disabled = true;
            if (btnDownload) btnDownload.disabled = true;
            if (renderContainer) {
                renderContainer.innerHTML = `
                    <div class="empty-state" style="padding: 5rem 2rem; text-align: center; color: var(--text-secondary); width: 100%; margin-top: 5cm; font-family: var(--font-ui);">
                        <i class="fa-solid fa-file-pdf empty-icon" style="font-size: 4rem; margin-bottom: 1rem; opacity: 0.4;"></i>
                        <p style="font-size: 1.1rem; font-weight: 500;">เลือกโครงการทางซ้ายเพื่อแสดงตัวอย่างและสั่งพิมพ์</p>
                    </div>
                `;
            }
            if (filenameSpan) filenameSpan.textContent = "-";
            this.cachedCloudPrintFileId = null;
            this.cachedCloudPrintFileData = null;
            return;
        }

        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        if (detailsEl) detailsEl.style.display = "block";
        const budgetVal = document.getElementById("print-project-budget-val");
        const ownerVal = document.getElementById("print-project-owner-val");
        if (budgetVal) budgetVal.textContent = this.formatCurrency(project.totalBudget) + " บาท";
        if (ownerVal) ownerVal.textContent = project.owner;
        
        if (project.projectFileId) {
            if (filenameSpan) filenameSpan.textContent = "กำลังโหลดเอกสาร...";
            this.fetchPrintCloudFile(project.projectFileId);
        } else {
            if (filenameSpan) filenameSpan.textContent = "ไม่มีเอกสารแนบในโครงการนี้";
            if (renderContainer) {
                renderContainer.innerHTML = `
                    <div class="empty-state" style="padding: 5rem 2rem; text-align: center; color: var(--text-secondary); width: 100%; margin-top: 5cm; font-family: var(--font-ui);">
                        <i class="fa-solid fa-triangle-exclamation empty-icon" style="font-size: 4rem; margin-bottom: 1rem; color: var(--warning-color); opacity: 0.8;"></i>
                        <p style="font-size: 1.1rem; font-weight: 500;">โครงการนี้ไม่มีไฟล์แนบจาก Google Drive</p>
                    </div>
                `;
            }
            if (btnPrint) btnPrint.disabled = true;
            if (btnDownload) btnDownload.disabled = true;
            this.cachedCloudPrintFileId = null;
            this.cachedCloudPrintFileData = null;
        }
    },

    fetchPrintCloudFile: function(fileId) {
        if (!fileId || !this.dbUrl) return;
        
        if (this.cachedCloudPrintFileId === fileId && this.cachedCloudPrintFileData) {
            this.renderPrintProjectPDF();
            return;
        }
        
        const loadingIndicator = document.getElementById("cloud-project-pdf-loading");
        if (loadingIndicator) loadingIndicator.style.display = "flex";
        
        this.cachedCloudPrintFileId = fileId;
        this.cachedCloudPrintFileData = null;
        
        fetch(this.dbUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify({
                action: "getProjectFile",
                fileId: fileId
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                const base64Data = res.data;
                const mimeType = res.mimeType;
                const name = res.name;
                
                if (mimeType === "application/pdf") {
                    const binaryString = window.atob(base64Data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    this.cachedCloudPrintFileData = {
                        name: name,
                        type: "pdf",
                        data: bytes.buffer
                    };
                } else {
                    this.cachedCloudPrintFileData = {
                        name: name,
                        type: "image",
                        data: `data:${mimeType};base64,${base64Data}`
                    };
                }
                
                if (loadingIndicator) loadingIndicator.style.display = "none";
                this.renderPrintProjectPDF();
            } else {
                throw new Error(res.message);
            }
        })
        .catch(err => {
            console.error("Error fetching cloud project file: ", err);
            if (loadingIndicator) loadingIndicator.style.display = "none";
            const filenameSpan = document.getElementById("print-project-filename");
            if (filenameSpan) filenameSpan.textContent = "ดาวน์โหลดล้มเหลว";
            alert("ไม่สามารถดึงไฟล์โครงการเต็มจาก Google Drive ได้: " + err.toString());
        });
    },

    renderPrintProjectPDF: function() {
        const container = document.getElementById("project-pdf-render-container");
        const filenameSpan = document.getElementById("print-project-filename");
        const btnPrint = document.getElementById("btn-print-project-pdf");
        const btnDownload = document.getElementById("btn-download-project-pdf");
        
        if (!container || !this.cachedCloudPrintFileData) return;
        container.innerHTML = "";
        
        const file = this.cachedCloudPrintFileData;
        if (filenameSpan) filenameSpan.textContent = file.name;
        
        if (btnPrint) btnPrint.disabled = false;
        if (btnDownload) btnDownload.disabled = false;
        
        if (file.type === "image") {
            const pageDiv = document.createElement("div");
            pageDiv.className = "memo-attached-page";
            pageDiv.style.width = "210mm";
            pageDiv.style.backgroundColor = "#ffffff";
            pageDiv.style.display = "flex";
            pageDiv.style.justifyContent = "center";
            pageDiv.style.alignItems = "center";
            
            const img = document.createElement("img");
            img.src = file.data;
            img.style.maxWidth = "100%";
            img.style.maxHeight = "100%";
            img.style.objectFit = "contain";
            
            pageDiv.appendChild(img);
            container.appendChild(pageDiv);
            setTimeout(() => this.adjustPrintPreviewScale(), 150);
        } else if (file.type === "pdf") {
            if (typeof pdfjsLib === "undefined") {
                console.error("PDF.js library is not loaded.");
                return;
            }
            if (typeof pdfjsLib !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
            }
            
            const typedarray = new Uint8Array(file.data);
            pdfjsLib.getDocument({ data: typedarray }).promise.then((pdf) => {
                let pagePromise = Promise.resolve();
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const num = pageNum;
                    pagePromise = pagePromise.then(() => {
                        return pdf.getPage(num).then((page) => {
                            const viewport = page.getViewport({ scale: 2.0 });
                            const canvas = document.createElement("canvas");
                            const context = canvas.getContext("2d");
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;
                            canvas.style.width = "100%";
                            canvas.style.height = "100%";
                            canvas.style.display = "block";
                            
                            const renderContext = {
                                canvasContext: context,
                                viewport: viewport
                            };
                            
                            return page.render(renderContext).promise.then(() => {
                                const pageDiv = document.createElement("div");
                                pageDiv.className = "memo-attached-page";
                                pageDiv.style.width = "210mm";
                                pageDiv.style.height = "297mm";
                                pageDiv.style.backgroundColor = "#ffffff";
                                pageDiv.style.boxSizing = "border-box";
                                pageDiv.style.overflow = "hidden";
                                
                                if (num > 1) {
                                    const pageBreak = document.createElement("div");
                                    pageBreak.className = "page-break";
                                    container.appendChild(pageBreak);
                                }
                                
                                pageDiv.appendChild(canvas);
                                container.appendChild(pageDiv);
                            });
                        });
                    });
                }
                return pagePromise.then(() => {
                    setTimeout(() => this.adjustPrintPreviewScale(), 150);
                });
            }).catch(err => {
                console.error("Error rendering PDF attachment: ", err);
                container.innerHTML = `<div class="empty-state"><p>เกิดข้อผิดพลาดในการแสดงผล PDF</p></div>`;
            });
        }
    },

    adjustPrintPreviewScale: function() {
        if (this.currentTab !== "project-print") return;
        
        const scrollContainer = document.querySelector("#tab-project-print .memo-paper-scroll");
        const wrapper = document.querySelector("#tab-project-print .memo-paper-scale-wrapper");
        const paper = document.getElementById("project-pdf-render-container");
        
        if (!scrollContainer || !wrapper || !paper) return;
        
        const containerWidth = scrollContainer.clientWidth - 48; // padding
        const paperWidth = paper.offsetWidth || 794; // 210mm in pixels (~794px)
        
        let scale = containerWidth / paperWidth;
        if (scale > 1) scale = 1;
        if (scale < 0.3) scale = 0.3;
        
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.width = "210mm";
        wrapper.style.transformOrigin = "top center";
        
        const scaledHeight = paper.offsetHeight * scale;
        scrollContainer.style.height = `${Math.max(scaledHeight + 50, 400)}px`;
    },

    downloadPrintProjectPDF: function() {
        if (!this.cachedCloudPrintFileData) return;
        
        const file = this.cachedCloudPrintFileData;
        
        if (file.type === "pdf") {
            const blob = new Blob([file.data], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name || "โครงการฉบับเต็ม.pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            const a = document.createElement("a");
            a.href = file.data;
            a.download = file.name || "โครงการฉบับเต็ม.png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    },

    // Convert Arabic numbers (0-9) to Thai numbers (๐-๙)
    toThaiNumerals: function(str) {
        if (str === null || str === undefined) return "";
        str = str.toString();
        const arabic = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        const thai = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
        for (let i = 0; i < 10; i++) {
            const regex = new RegExp(arabic[i], "g");
            str = str.replace(regex, thai[i]);
        }
        return str;
    }
};

// Initialize Application on page load
document.addEventListener("DOMContentLoaded", () => {
    app.init();
});
