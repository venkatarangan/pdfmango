<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { IconName } from '../lib/icons';
  import Icon from './Icon.svelte';

  type Props = HTMLButtonAttributes & { icon: IconName; label: string; tipAbove?: boolean };
  let { icon, label, tipAbove = false, class: cls = '', ...rest }: Props = $props();
</script>

<button type="button" class="icon-btn tip {cls}" class:tip-above={tipAbove} aria-label={label} data-tip={label} {...rest}>
  <Icon name={icon} />
</button>
