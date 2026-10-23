use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Maximum number of whitelisted target programs stored per user policy PDA.
pub const MAX_WHITELISTED_PROGRAMS: usize = 16;

/// Seconds in a 24-hour rolling window for daily spend limits.
pub const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod solshield_policy {
    use super::*;

    /// Initializes a deterministic `SecurityPolicy` PDA for the signer's wallet.
    /// Enforces on-chain spending guardrails, maximum Venice AI risk threshold,
    /// and an allowlist of trusted target program IDs.
    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        max_daily_spend_lamports: u64,
        max_allowed_risk_score: u8,
        block_unknown_transfer_hooks: bool,
    ) -> Result<()> {
        require!(
            max_allowed_risk_score <= 100,
            SolShieldError::InvalidRiskScoreThreshold
        );
        require!(
            max_daily_spend_lamports > 0,
            SolShieldError::InvalidDailyLimit
        );

        let clock = Clock::get()?;
        let policy = &mut ctx.accounts.security_policy;

        policy.owner = ctx.accounts.owner.key();
        policy.bump = ctx.bumps.security_policy;
        policy.max_daily_spend_lamports = max_daily_spend_lamports;
        policy.spent_today_lamports = 0;
        policy.window_start_timestamp = clock.unix_timestamp;
        policy.max_allowed_risk_score = max_allowed_risk_score;
        policy.block_unknown_transfer_hooks = block_unknown_transfer_hooks;
        policy.emergency_locked = false;
        policy.audited_tx_count = 0;
        policy.whitelisted_programs = Vec::new();

        emit!(PolicyInitializedEvent {
            owner: policy.owner,
            max_daily_spend_lamports,
            max_allowed_risk_score,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Updates the owner's security policy limits.
    /// Strict `has_one = owner` and `Signer` constraints prevent unauthorized mutation.
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        max_daily_spend_lamports: u64,
        max_allowed_risk_score: u8,
        block_unknown_transfer_hooks: bool,
    ) -> Result<()> {
        require!(
            max_allowed_risk_score <= 100,
            SolShieldError::InvalidRiskScoreThreshold
        );
        require!(
            max_daily_spend_lamports > 0,
            SolShieldError::InvalidDailyLimit
        );

        let policy = &mut ctx.accounts.security_policy;
        require!(!policy.emergency_locked, SolShieldError::PolicyEmergencyLocked);

        policy.max_daily_spend_lamports = max_daily_spend_lamports;
        policy.max_allowed_risk_score = max_allowed_risk_score;
        policy.block_unknown_transfer_hooks = block_unknown_transfer_hooks;

        Ok(())
    }

    /// Adds or removes a target program ID (e.g., Jupiter v6, Raydium, SPL Token)
    /// from the user's on-chain whitelist.
    pub fn manage_whitelist(
        ctx: Context<UpdatePolicy>,
        target_program: Pubkey,
        allow: bool,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.security_policy;
        require!(!policy.emergency_locked, SolShieldError::PolicyEmergencyLocked);

        if allow {
            if !policy.whitelisted_programs.contains(&target_program) {
                require!(
                    policy.whitelisted_programs.len() < MAX_WHITELISTED_PROGRAMS,
                    SolShieldError::WhitelistCapacityExceeded
                );
                policy.whitelisted_programs.push(target_program);
            }
        } else {
            policy
                .whitelisted_programs
                .retain(|& existing| existing != target_program);
        }

        Ok(())
    }

    /// Instant circuit-breaker (kill switch) allowing the wallet owner to freeze
    /// all policy-guarded executions if suspicious activity is detected.
    pub fn set_emergency_lock(ctx: Context<UpdatePolicy>, locked: bool) -> Result<()> {
        let policy = &mut ctx.accounts.security_policy;
        policy.emergency_locked = locked;

        emit!(EmergencyLockEvent {
            owner: policy.owner,
            locked,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Validates a proposed transaction execution against the owner's on-chain guardrails:
    /// 1. Checks emergency lock status.
    /// 2. Verifies the Venice AI risk score is below `max_allowed_risk_score`.
    /// 3. Verifies the target program is whitelisted (if whitelist is non-empty).
    /// 4. Resets 24h rolling window if elapsed, and enforces daily lamport spend limit
    ///    using checked arithmetic to prevent integer overflow.
    pub fn verify_and_record_execution(
        ctx: Context<VerifyExecution>,
        target_program: Pubkey,
        spend_lamports: u64,
        venice_risk_score: u8,
        has_unverified_transfer_hook: bool,
        intent_digest: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let policy = &mut ctx.accounts.security_policy;

        // 1. Check circuit breaker
        require!(!policy.emergency_locked, SolShieldError::PolicyEmergencyLocked);

        // 2. Check Token-2022 malicious transfer hook policy
        if policy.block_unknown_transfer_hooks {
            require!(
                !has_unverified_transfer_hook,
                SolShieldError::UnverifiedTransferHookBlocked
            );
        }

        // 3. Enforce Venice AI risk threshold
        require!(
            venice_risk_score <= policy.max_allowed_risk_score,
            SolShieldError::RiskScoreExceedsPolicy
        );

        // 4. Enforce program allowlist if configured
        if !policy.whitelisted_programs.is_empty() {
            require!(
                policy.whitelisted_programs.contains(&target_program),
                SolShieldError::TargetProgramNotWhitelisted
            );
        }

        // 5. Rolling 24-hour window reset & checked daily spend accumulation
        let elapsed = clock
            .unix_timestamp
            .checked_sub(policy.window_start_timestamp)
            .ok_or(SolShieldError::ArithmeticOverflow)?;

        if elapsed >= SECONDS_PER_DAY {
            policy.spent_today_lamports = 0;
            policy.window_start_timestamp = clock.unix_timestamp;
        }

        let new_spent = policy
            .spent_today_lamports
            .checked_add(spend_lamports)
            .ok_or(SolShieldError::ArithmeticOverflow)?;

        require!(
            new_spent <= policy.max_daily_spend_lamports,
            SolShieldError::DailySpendLimitExceeded
        );

        policy.spent_today_lamports = new_spent;
        policy.audited_tx_count = policy
            .audited_tx_count
            .checked_add(1)
            .ok_or(SolShieldError::ArithmeticOverflow)?;

        emit!(AuditedExecutionEvent {
            owner: policy.owner,
            target_program,
            spend_lamports,
            venice_risk_score,
            intent_digest,
            audited_tx_count: policy.audited_tx_count,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + SecurityPolicy::INIT_SPACE,
        seeds = [b"solshield_policy", owner.key().as_ref()],
        bump
    )]
    pub security_policy: Account<'info, SecurityPolicy>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SolShieldError::UnauthorizedOwner,
        seeds = [b"solshield_policy", owner.key().as_ref()],
        bump = security_policy.bump
    )]
    pub security_policy: Account<'info, SecurityPolicy>,
}

#[derive(Accounts)]
pub struct VerifyExecution<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SolShieldError::UnauthorizedOwner,
        seeds = [b"solshield_policy", owner.key().as_ref()],
        bump = security_policy.bump
    )]
    pub security_policy: Account<'info, SecurityPolicy>,
}

#[account]
#[derive(InitSpace)]
pub struct SecurityPolicy {
    /// Wallet owner authority who controls this policy PDA.
    pub owner: Pubkey,
    /// Canonical PDA bump seed.
    pub bump: u8,
    /// Maximum lamports allowed to be spent within a rolling 24h window.
    pub max_daily_spend_lamports: u64,
    /// Cumulative lamports spent in the current 24h window.
    pub spent_today_lamports: u64,
    /// Unix timestamp marking the start of the current 24h rolling window.
    pub window_start_timestamp: i64,
    /// Maximum Venice AI risk score (0-100) permitted before blocking execution.
    pub max_allowed_risk_score: u8,
    /// Automatically block Token-2022 mints with unverified TransferHook extensions.
    pub block_unknown_transfer_hooks: bool,
    /// Emergency circuit-breaker flag.
    pub emergency_locked: bool,
    /// Total number of transactions verified by this policy PDA.
    pub audited_tx_count: u64,
    /// Allowlist of verified program IDs (e.g., Jupiter v6, SPL Token).
    #[max_len(MAX_WHITELISTED_PROGRAMS)]
    pub whitelisted_programs: Vec<Pubkey>,
}

#[event]
pub struct PolicyInitializedEvent {
    pub owner: Pubkey,
    pub max_daily_spend_lamports: u64,
    pub max_allowed_risk_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyLockEvent {
    pub owner: Pubkey,
    pub locked: bool,
    pub timestamp: i64,
}

#[event]
pub struct AuditedExecutionEvent {
    pub owner: Pubkey,
    pub target_program: Pubkey,
    pub spend_lamports: u64,
    pub venice_risk_score: u8,
    pub intent_digest: [u8; 32],
    pub audited_tx_count: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum SolShieldError {
    #[msg("Risk score threshold must be between 0 and 100.")]
    InvalidRiskScoreThreshold,
    #[msg("Daily spend limit must be greater than zero lamports.")]
    InvalidDailyLimit,
    #[msg("Unauthorized: Signer does not match the policy owner.")]
    UnauthorizedOwner,
    #[msg("Execution blocked: Security policy is currently in emergency lock mode.")]
    PolicyEmergencyLocked,
    #[msg("Execution blocked: Venice AI risk score exceeds your policy threshold.")]
    RiskScoreExceedsPolicy,
    #[msg("Execution blocked: Target program is not in your policy whitelist.")]
    TargetProgramNotWhitelisted,
    #[msg("Execution blocked: Daily lamport spending limit would be exceeded.")]
    DailySpendLimitExceeded,
    #[msg("Execution blocked: Unverified Token-2022 Transfer Hook detected.")]
    UnverifiedTransferHookBlocked,
    #[msg("Whitelist capacity reached (maximum 16 programs).")]
    WhitelistCapacityExceeded,
    #[msg("Checked arithmetic overflow or underflow detected.")]
    ArithmeticOverflow,
}
