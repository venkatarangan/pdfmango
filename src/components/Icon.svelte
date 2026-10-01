<script lang="ts">
  import { icons, type IconName } from '../lib/icons';

  let { name, size = 24 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" viewBox="0 -960 960 960" width={size} height={size} style:width="{size}px" style:height="{size}px" aria-hidden="true" focusable="false"><path d={icons[name]} /></svg>
