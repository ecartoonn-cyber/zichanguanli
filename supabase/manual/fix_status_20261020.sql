-- 2026-10-20 修复：无行情代码持仓改为 unsupported，QDII 净值日期回退到 10-16
-- 在 Supabase Dashboard > SQL Editor 执行
begin;

-- 1. 三类无公开行情代码的持仓标为 unsupported
update user_market_tracking
set status = 'unsupported',
    reason = case holding_id
      when 'h021-b73e156f' then '支付宝定制产品，无公开基金代码'
      when 'h034-90805a0a' then '银行活期/现金，无净值'
      when 'h035-47e7818f' then '招行专属理财，无公开代码'
    end,
    enabled = false,
    updated_at = now()
where holding_id in ('h021-b73e156f', 'h034-90805a0a', 'h035-47e7818f');

-- 2. QDII 净值 T+2 公布，latest_price_date 回退到 10-16
update user_market_tracking
set latest_price_date = '2026-10-16',
    reason = 'QDII 净值 T+2 公布，最新可得 10-16',
    updated_at = now()
where holding_id in (
  'h014-6be0aaa6', -- 270023 广发全球精选
  'h015-2b0651db', -- 008763 天弘越南
  'h017-df5ac2fe', -- 005698 华夏全球科技A
  'h018-8a35564e', -- 008254 华宝致远
  'h022-a12812a2', -- 021539 华安法国CAC40
  'h024-d1718f06', -- 015016 华安德国DAX
  'h029-ea354cde', -- 006105 宏利印度
  'h032-e53fbc68', -- 024239 华夏全球科技C
  'h033-df7dc7ce'  -- 012920 易方达全球成长
);

-- 3. 验证
select status, count(*) from user_market_tracking group by status order by status;

commit;
