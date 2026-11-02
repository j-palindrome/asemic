-- asemic embedded-nvim config (the only row editor).
-- Swapfile on, autoread, treesitter folding w/ indent fallback, arrow-key fold nav in NORMAL.

vim.opt.swapfile = true
vim.opt.autoread = true
vim.opt.foldlevel = 99
vim.opt.foldlevelstart = 99
vim.opt.fillchars:append({ eob = " " })  -- end-of-buffer rows render blank (popup-menu room)
vim.opt.completeopt = { "menu", "menuone", "noselect" }

-- Completion popup navigation and selection:
-- Tab: if popup is visible, select/cycle to choice (or top choice if none highlighted); else normal Tab
-- Down / Up: if popup is visible, cycle down/up menu items; else normal Down / Up line movement
-- Enter (<CR>): if popup is visible, confirm selection (<C-y>); else normal newline
vim.keymap.set("i", "<Tab>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-n>"
  end
  return "<Tab>"
end, { expr = true, remap = false, desc = "asemic: pum select/next" })

vim.keymap.set("i", "<Down>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-n>"
  end
  return "<Down>"
end, { expr = true, remap = false, desc = "asemic: pum next" })

vim.keymap.set("i", "<Up>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-p>"
  end
  return "<Up>"
end, { expr = true, remap = false, desc = "asemic: pum prev" })

vim.keymap.set("i", "<CR>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-y>"
  end
  return "<CR>"
end, { expr = true, remap = false, desc = "asemic: pum confirm" })

-- Python LSP (pylsp) -> only enable if explicitly requested via `asemic_pylsp`.
-- By default disabled: completions are served instantly via native `AsemicOmni` from
-- `_api.pyi`, avoiding heavy jedi/pylsp CPU spikes & typing lag in the embedded editor.
local function pylsp_cmd()
  local p = vim.g.asemic_pylsp
  if type(p) == "string" and p ~= "" then return { p } end
  return nil
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = "python",
  callback = function(args)
    local cmd = pylsp_cmd()
    if not cmd then return end
    local cfg = vim.lsp.config("pylsp", {
      cmd = cmd,
      filetypes = { "python" },
      root_dir = vim.g.asemic_root or vim.fn.getcwd(),
      -- completion + hover only: the row editor is a 1-line grid, keep linting noise out
      settings = { pylsp = { plugins = {
        jedi_completion = { enabled = true, fuzzy = true },
        jedi_hover = { enabled = true },
        pyflakes = { enabled = false },
        pycodestyle = { enabled = false },
        mccabe = { enabled = false },
        flake8 = { enabled = false },
        pylint = { enabled = false },
        rope_autoimport = { enabled = false },
      } } },
    })
    -- start for THIS buffer directly: `vim.lsp.enable` only picks up future FileType events,
    -- and the row scratch buffer's filetype is set once, moments after attach.
    vim.lsp.start(cfg or vim.lsp.config["pylsp"], { bufnr = args.buf })
  end,
})

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    -- LSP completion left OFF: the popup is nvim-native now (`AsemicOmni` below), fed the verb
    -- list from `asemic_py/_api.pyi`. The pylsp client still attaches (hover/definition).
    if client and client.name == "pylsp" then
      -- vim.lsp.completion.enable(true, client.id, args.buf, { autotrigger = true })
    end
  end,
})

-- nvim-native verb completion (no LSP round-trip). Python parses the generated stub
-- `asemic_py/_api.pyi` into `vim.g.asemic_completions` (`{word, menu, info, kind}` per verb) and
-- marks the row scratch buffer (`vim.b.asemic_row`, `omnifunc=v:lua.AsemicOmni`). Autotriggers as
-- you type an identifier; `<C-x><C-o>` works too. `for now`: replaces the pylsp popup path.
-- Context-aware call parsing: returns the enclosing function name, active assigned kwarg (including inside tuples/lists), and used kwargs
local function find_call_context(line)
  local stack = {}
  local in_single = false
  local in_double = false
  local escape = false
  local len = #line
  for i = 1, len do
    local ch = line:sub(i, i)
    if escape then
      escape = false
    elseif ch == "\\" then
      escape = true
    elseif ch == "\x27" and not in_double then
      in_single = not in_single
    elseif ch == "\"" and not in_single then
      in_double = not in_double
    elseif not in_single and not in_double then
      if ch == "(" or ch == "{" or ch == "[" then
        local prefix = line:sub(1, i - 1)
        local fn_name = (ch == "(") and prefix:match("([%a_][%w_]*)%s*$") or nil
        local kw_target = prefix:match("([%a_][%w_]*)%s*=%s*$")
        table.insert(stack, { fn = fn_name, kw = kw_target, pos = i, kind = ch, used = {} })
      elseif ch == ")" or ch == "}" or ch == "]" then
        if #stack > 0 then table.remove(stack) end
      elseif ch == "=" and #stack > 0 then
        local sub = line:sub(stack[#stack].pos + 1, i - 1)
        local kw = sub:match("([%a_][%w_]*)%s*$")
        if kw then stack[#stack].used[kw] = true end
      end
    end
  end

  local fn_name = nil
  local used_kwargs = {}
  for idx = #stack, 1, -1 do
    if stack[idx].fn then
      fn_name = stack[idx].fn
      used_kwargs = stack[idx].used
      break
    end
  end

  local active_kw = nil
  for idx = #stack, 1, -1 do
    if stack[idx].kw then
      active_kw = stack[idx].kw
      break
    end
  end

  local direct_kw = line:match("([%a_][%w_]*)%s*=%s*([\"\x27]?)([%w_]*)$")
  if direct_kw then active_kw = direct_kw end

  return fn_name, active_kw, used_kwargs
end

local function asemic_matches(base)
  local head = vim.api.nvim_get_current_line():sub(1, vim.fn.col(".") - 1)
  local fn_name, active_kw, used_kwargs = find_call_context(head)

  -- Check if completing an enum value: directly after `kw=...` or inside a tuple/list `kw=(..., ...)`
  local quote_char, val_prefix = head:match("([\"\x27]?)([%w_]*)$")
  if fn_name and active_kw then
    for _, it in ipairs(vim.g.asemic_completions or {}) do
      if it.word == fn_name and it.kwarg_meta and it.kwarg_meta[active_kw] then
        local meta = it.kwarg_meta[active_kw]
        if meta.choices and #meta.choices > 0 then
          local val_matches = {}
          local close_q = (quote_char ~= "") and quote_char or "\""
          for _, c in ipairs(meta.choices) do
            if vim.startswith(c, val_prefix or "") then
              table.insert(val_matches, {
                word = (quote_char == "" and ("\"" .. c .. "\"") or (c .. quote_char)),
                menu = active_kw .. " choice",
                info = (meta.type or "") .. " enum value",
                kind = "m",
              })
            end
          end
          if #val_matches > 0 then
            return val_matches
          end
        end
      end
    end
  end

  -- If inside func(...), offer available kwargs for that function
  if fn_name then
    local target_verb = nil
    for _, it in ipairs(vim.g.asemic_completions or {}) do
      if it.word == fn_name then
        target_verb = it
        break
      end
    end
    if target_verb and target_verb.kwargs and #target_verb.kwargs > 0 then
      local kw_matches = {}
      for _, kw in ipairs(target_verb.kwargs) do
        if not (used_kwargs and used_kwargs[kw]) and vim.startswith(kw, base) then
          local meta = target_verb.kwarg_meta and target_verb.kwarg_meta[kw]
          local t_info = meta and meta.type and (meta.type .. " ") or ""
          if meta and meta.choices and #meta.choices > 0 then
            t_info = t_info .. "[" .. table.concat(meta.choices, "|") .. "]"
          end
          table.insert(kw_matches, {
            word = kw .. "=",
            menu = t_info ~= "" and t_info or (fn_name .. " kwarg"),
            info = target_verb.info or "",
            kind = "v",
          })
        end
      end
      if #kw_matches > 0 then
        return kw_matches
      end
    end
  end

  local out = {}
  for _, it in ipairs(vim.g.asemic_completions or {}) do
    if vim.startswith(it.word, base) then out[#out + 1] = it end
  end
  return out
end

function _G.AsemicOmni(findstart, base)
  if findstart == 1 then
    local head = vim.api.nvim_get_current_line():sub(1, vim.fn.col(".") - 1)
    local quote_char, val_prefix = head:match("([\"\x27])([%w_]*)$")
    if quote_char then
      return #head - #val_prefix
    end
    local kw = head:match("[%a_][%w_]*$")
    return kw and (#head - #kw) or vim.fn.col(".")
  end
  return asemic_matches(base)
end

vim.api.nvim_create_autocmd("TextChangedI", {
  pattern = "*",
  callback = function()
    if not vim.b.asemic_row or vim.fn.pumvisible() ~= 0 then return end
    local head = vim.api.nvim_get_current_line():sub(1, vim.fn.col(".") - 1)

    local quote_char, val_prefix = head:match("([\"\x27])([%w_]*)$")
    local startcol = nil
    local base_kw = ""
    if quote_char then
      startcol = #head - #val_prefix + 1
      base_kw = val_prefix
    else
      local kw = head:match("[%a_][%w_]*$")
      if kw then
        startcol = #head - #kw + 1
        base_kw = kw
      end
    end

    if not startcol then return end
    local items = asemic_matches(base_kw)
    if #items > 0 then vim.fn.complete(startcol, items) end
  end,
})

local ok, has_parser = pcall(function()
  vim.treesitter.language.add("python")
  return vim.treesitter.get_parser(0, "python") ~= nil
end)
local ok_ts = ok and has_parser
if ok_ts then
  vim.opt.foldmethod = "expr"
  vim.opt.foldexpr = "v:lua.vim.treesitter.foldexpr()"
else
  vim.opt.foldmethod = "indent"
end

-- Fold-aware tree nav on arrow keys, NORMAL mode only (hjkl & INSERT arrows stay native).
-- Down/Up: next/prev fold-start line. Right: open fold + step inside. Left: close fold,
-- or jump to the enclosing fold's start if already closed/no fold here.
vim.keymap.set("n", "<Down>", "zj", { desc = "asemic: next fold-start" })
vim.keymap.set("n", "<Up>", "zk", { desc = "asemic: prev fold-start" })
vim.keymap.set("n", "<Right>", function()
  vim.cmd("normal! zo")
  vim.cmd("normal! j")
end, { desc = "asemic: open fold + descend" })
vim.keymap.set("n", "<Left>", function()
  if vim.fn.foldclosed(".") ~= -1 then
    vim.cmd("normal! [z")
  else
    vim.cmd("normal! zc")
  end
end, { desc = "asemic: close fold / to parent" })

-- RPC bridge to the Python side. Python pushes its channel id into vim.g.asemic_chans
-- (a list -- supports future multi-client) right after attaching; we notify all of them.
vim.g.asemic_chans = vim.g.asemic_chans or {}

local function notify_all(event, data)
  for _, chan in ipairs(vim.g.asemic_chans) do
    pcall(vim.rpcnotify, chan, event, data)
  end
end

local function notify_text()
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  notify_all("asemic_text", { table.concat(lines, "\n") })
end

local grp = vim.api.nvim_create_augroup("AsemicBridge", { clear = true })

-- In insert mode, debounce text notifications by 60ms to avoid flooding msgpack RPC while typing
local text_timer = nil
local function notify_text_debounced()
  if text_timer then
    text_timer:stop()
  else
    text_timer = vim.uv.new_timer()
  end
  text_timer:start(60, 0, vim.schedule_wrap(function()
    notify_text()
  end))
end

vim.api.nvim_create_autocmd({ "TextChanged", "BufWritePost" }, {
  group = grp,
  callback = notify_text,
})

vim.api.nvim_create_autocmd("TextChangedI", {
  group = grp,
  callback = notify_text_debounced,
})

-- `:h[elp] [topic]` typed in the 1-line row editor: abort it here and hand the topic to
-- Python, which opens a full-size `NvimHelpView` pane (real nvim :help, user's config/plugins).
-- `<CR>` cmap (not CmdlineLeave + v:event.abort: abort didn't cancel :help, so help took over the row).
vim.keymap.set("c", "<CR>", function()
  if vim.fn.getcmdtype() == ":" then
    local cmd, topic = vim.fn.getcmdline():match("^%s*(%a+)!?%s*(.-)%s*$")
    if cmd and ("help"):sub(1, #cmd) == cmd then
      notify_all("asemic_help", topic)
      return "<C-u><C-c>"
    end
  end
  return "<CR>"
end, { expr = true, desc = "asemic: :help -> help pane" })

vim.api.nvim_create_autocmd("CursorMoved", {
  group = grp,
  callback = function()
    local line = vim.api.nvim_win_get_cursor(0)[1]
    notify_all("asemic_cursor", { line })
  end,
})
