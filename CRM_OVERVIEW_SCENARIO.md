# Ideav CRM System Overview Scenario

**Reading time:** 3-5 minutes
**Goal:** Introduce users to the main CRM functionality and demonstrate a typical sales manager's workday

---

## 0. Main Screen — Manager's Workspace

**Entry point:** After login, the CRM home page opens

### What the user sees:
- **Top navigation menu** with system sections
- **Main work area** — Tasks section is open by default
- **Quick links panel** for frequently used functions

### Actions to demonstrate:
1. Notice the **user menu** in the top right corner (profile icon)
   - Show language switching (RU/EN)
   - Account settings access
   - "Help" section

2. In the central area — **tasks table** with capabilities:
   - Filtering by various parameters
   - Infinite scroll
   - Search across all fields

**💡 Key point:** This is your main "office" — here you see all current tasks and can quickly switch between CRM sections.

---

## 1. Working with Unpaid Invoices and Reminders

**Navigation:** Top menu → tasks section or kanban

### Use case:
You have issued invoices that require sending reminders to clients.

### Actions:
1. **Open the sales kanban** (board icon in menu)
   - You'll see a sales funnel with 11 stages
   - Find the **"Payment"** column (3699) or **"Repeat Payment"** (3701)

2. **Working with a lead card:**
   - Click on a client card in the "Payment" column
   - An edit form opens with complete client information
   - Visible here: contacts, status, associated partner, lead source

3. **Creating a reminder task:**
   - On the lead card, find the **"+" icon next to the tasks icon**
   - Click it — a quick task creation form opens
   - Select **task type** from dropdown, for example:
     - "Call"
     - "Remind about renewal"
     - "Warm-up / touch"
   - **Task name auto-fills** based on selected type
   - Set **deadline** (required field)
   - Select **executor** (yourself or colleague)
   - Click "Save"

4. **Verify created task:**
   - A **badge with task count** appears on the lead card
   - Click the badge — a table of all tasks for this lead opens
   - Now the task also appears in the main "Tasks" section

**💡 Key point:** The system helps you remember important client contacts. All reminders (calls, emails, meetings) are recorded as tasks with deadlines and executors.

---

## 2. Working with Leads — New Applications

**Navigation:** Stay on the sales kanban

### Scenario: You received a new application from a potential client

### 2.1. Send Materials for Requested Software

**Actions:**
1. **Find the new lead card** in the leftmost column **"Lead"** (3689 — dark red)
2. **Click on the lead name** — edit form opens
3. Review information:
   - Contact details (field t536 — phone)
   - Application source (field t5309)
   - Requested software/product
4. **Create "Send materials" task:**
   - Click "+" near the tasks icon on the card
   - Select task type "Send update"
   - Name auto-fills
   - Set deadline (e.g., "today")
   - Assign yourself as executor
   - Save the task

**Result:** Task appears in your to-do list, and the lead card's task counter increases.

---

### 2.2. Call Planning

**Actions:**
1. **Move the lead to next stage:**
   - Grab the card with mouse (drag)
   - Drag to **"Initial Contact"** column (3691 — dark red-orange)
   - Release — lead status updates automatically

2. **Schedule a call:**
   - Again open quick task creation form ("+")
   - Select type "Call"
   - Specify call time in "Deadline" field
   - Select executor
   - Save

**💡 Key point:** Kanban visualizes the client's journey from first contact to payment. Dragging cards between columns updates status automatically.

---

### 2.3. Planning Various Task Types

CRM supports creating different task types for working with leads:

**Available task types** (selected from reference report/5241):
- **Call** — schedule a phone conversation
- **Send update** — send materials, price lists, software updates
- **Video call** — online meeting, product demonstration
- **Warm-up / touch** — maintain contact, light communication
- **Remind about renewal** — work with existing clients
- **Add OS for development** — technical task
- **Transfer lead to partner** — pass client to partner
- **Process tasks of all employees being substituted** — when covering for a colleague

**How to plan tasks:**
1. All tasks are created the same way — via "+" button on lead card
2. When selecting task type, its name auto-fills
3. You can edit the name manually if needed
4. Must specify deadline
5. Assign executor (can assign task to colleague)

**Example creating "Video call" task:**
1. Open lead card in "Presentation/demo" column (2849)
2. Click "+" near tasks
3. Select type "Video call"
4. Name auto-fills
5. Set date and time of video meeting
6. Assign yourself as executor
7. Save

**💡 Tip:** Use filters on kanban to select leads:
- By manager (button "Manager" at top)
- By product (button "Product")
- By partner/regular client type (toggle "Partner")

---

### 2.4. Issuing Invoices to Distributors

**Scenario:** Client is ready to purchase, need to issue invoice

**Navigation:** Lead should be in "Deal Closure" column (3697) or further

### Actions:

1. **Create a deal:**
   - Find the **"+ deals" icon** on the lead card (next to deal count badge)
   - Click it — deal creation form opens
   - In the form specify:
     - **Deal type** (select from list)
     - **Partner/Company** (field t479) — select distributor from reference
     - **Note** (field t636) — indicate sale parameters:
       - Number of licenses
       - Price per unit
       - Total amount
       - License validity period
   - Click "Create"

2. **Verify deal:**
   - A badge with deal count appears on lead card
   - Click the badge — table of all deals for this lead opens
   - Complete deal information is visible here

3. **Workflow with distributor** (according to task description):
   - Invoice is issued to distributor for verification
   - After distributor confirmation — sent to accounting
   - For each renewal — new deal (1 deal = 1 invoice)
   - Request PDF invoice from accounting (unsigned)
   - Send PDF to distributor for approval
   - After confirmation — ship licenses
   - Accounting issues invoice in EDI

4. **Moving lead through funnel:**
   - After issuing invoice, drag lead to **"Payment"** column (3699)
   - After receiving payment — to **"Repeat Payment"** column (3701) for future renewals
   - If deal fell through — to **"Rejection/deal loss"** column (2824)

**💡 Key point:** Each deal is recorded separately and linked to the lead. This allows tracking the entire sales history to the client and seeing how many deals are concluded per lead.

---

## 3. Working with Partners — Onboarding and Agreement Coordination

**Navigation:** Top menu → "Partners" section or use "Partner" filter on kanban

### Scenario: New partner, need to conduct onboarding

### Actions:

1. **View partner list:**
   - Go to "Partners" section (partners.html)
   - You'll see a table of all partners/clients
   - Available:
     - Column filtering
     - Search by company name
     - Sorting
     - View distributor status

2. **Working with partner on kanban:**
   - Return to kanban
   - Enable **"Partner"** toggle at top
   - Kanban displays only partner leads
   - Find new partner (usually in initial columns)

3. **Partner onboarding — creating tasks:**
   - Open partner card
   - Create a series of onboarding tasks:

     **Task 1: Video call — introduction**
     - Type: "Video call"
     - Deadline: in coming days
     - Goal: meet, tell about product

     **Task 2: Send materials**
     - Type: "Send update"
     - Deadline: right after video call
     - Goal: provide presentation, price list, partnership terms

     **Task 3: Agreement coordination**
     - Type: "Call" or "Video call"
     - Deadline: week after sending materials
     - Goal: discuss partnership terms, commissions, volumes

4. **Moving partner through funnel:**
   - After first contact → **"Initial Contact"** (3691)
   - After partner qualification → **"Qualification"** (3693)
   - After sending commercial proposal → **"Quote Sent"** (3695)
   - After presenting terms → **"Presentation/demo"** (2849)
   - When coordinating terms → **"Agreement"** (2843)
   - When testing collaboration → **"Trial/pilot"** (2806)
   - When signing contract → **"Deal Closure"** (3697)
   - After first joint sale → **"Payment"** (3699)

5. **Creating deal with partner:**
   - When partner is ready for collaboration, create first deal
   - Use "+ deals" form on card
   - Specify:
     - Partner in "Partner/Company" field
     - Collaboration terms in notes
     - Deal type (partnership)

**💡 Key point:** Partners go through the same funnel as regular clients, but with focus on long-term collaboration. Use "Partner" filter for quick access to partner leads.

---

## Additional Useful Features

### Filtering and Search

**On kanban:**
- **"Manager" button** — filter by responsible manager
- **"Product" button** — filter by product of interest
- **"Partner" toggle** — show only partners or only regular clients
- **Search field** — quick search by lead name

**In tables:**
- Each column has a filter field
- Available operators: "starts with", "contains", "equals", "greater/less" and others
- Can combine multiple filters simultaneously

### Quick Creation of Related Objects

**Directly from forms you can create:**
- New partners ("+" button in partner selection field)
- New task types (via references)
- New lead sources
- New products

### Table Display Settings

**Available in tables:**
- Change column order (drag-and-drop headers)
- Hide/show columns (settings icon)
- Save settings in cookies (next login everything will be the same)
- Infinite scroll (no need to switch pages)

### Working with Tasks in Main Section

**In "Tasks" section:**
- All tasks from all leads are visible
- Can filter by executor, deadline, type
- Clickable links to leads
- Ability to edit tasks directly from table
- Highlighting of overdue tasks

---

## Typical Sales Manager's Workday in CRM

**Morning (9:00 - 10:00):**
1. Open "Tasks" section
2. Filter tasks for today
3. Review list of calls and meetings
4. Start work with first task

**Day (10:00 - 18:00):**
1. Work with sales kanban
2. Move leads through funnel after contacts
3. Create new tasks based on call results
4. Issue invoices to ready clients
5. Monitor new applications in "Lead" column

**End of day (18:00 - 19:00):**
1. Check unclosed tasks for today
2. Postpone unfinished tasks to tomorrow
3. Plan tasks for next day
4. Check leads in "Payment" and "Repeat Payment" columns — who needs reminders

---

## Conclusion

Ideav CRM system is a complete sales management tool that helps:

✅ **Not lose clients** — all leads on kanban, their status is always visible
✅ **Not forget tasks** — reminder system with deadlines
✅ **See the whole picture** — from first contact to repeat sales
✅ **Work with partners** — separate mode for partnership relations
✅ **Control deals** — each sale is recorded and linked to lead
✅ **Customize for yourself** — flexible filters, saved settings, executor selection

**Start working right now:**
1. Open kanban
2. Find your leads
3. Create first task
4. Move lead to next stage after completion

Successful sales! 🚀
