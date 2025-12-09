import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useMatchActions } from '@app/hooks/useTournaments';
import { colors } from '@app/styles/colors';

interface Props {
  matchId: string;
  reporterTeamId?: string;
}

export const MatchScreen: React.FC<Props> = ({ matchId, reporterTeamId }) => {
  const { report, accept } = useMatchActions();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Partido</Text>
      <Button
        title={report.isLoading ? 'Enviando...' : 'Reportar resultado'}
        onPress={() =>
          reporterTeamId
            ? report.mutate({
                matchId,
                reporterTeamId,
                resultType: 'normal',
                setScores: [{ home: 6, away: 4 }],
              })
            : undefined
        }
      />
      <Button title={accept.isLoading ? 'Aceptando...' : 'Aceptar resultado'} onPress={() => accept.mutate(matchId)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, gap: 12, padding: 16 },
  title: { fontSize: 24, fontWeight: '600' },
});

